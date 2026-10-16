import { fireEvent } from "@testing-library/react";

import {
  createMockMediaQueryList,
  renderWithProviders,
  screen,
} from "__support__/ui";
import {
  NativeQueryEditorContextProvider,
  type NativeQueryEditorContextValue,
} from "metabase/querying/components/NativeQueryEditor/context/NativeQueryEditorContext";
import { readVisibleGroupSlugs } from "metabase/querying/components/parameter-display-config";
import { createMockParameter } from "metabase-types/api/mocks";

import { ParameterDisplayConfigButton } from "./ParameterDisplayConfigButton";

jest.mock("metabase/common/hooks/use-locale", () => ({
  useLocale: () => ({ locale: "en" }),
}));

const parameters = Array.from({ length: 6 }, (_, index) =>
  createMockParameter({
    id: `${index}`,
    name: `Parameter ${index}`,
    slug: `parameter-${index}`,
  }),
);
function setup(isNativeEditorOpen = false) {
  // The slot reads only these three values from the editor context.
  const context = {
    question: { id: () => 1, parameters: () => parameters },
    query: {
      queryText: () => "SELECT date, SUM(amount) FROM sales GROUP BY date",
      setQueryText: jest.fn((queryText) => ({
        queryText: () => queryText,
      })),
    },
    setDatasetQuery: jest.fn(),
    isNativeEditorOpen,
    setParameterValue: jest.fn(),
  } as unknown as NativeQueryEditorContextValue;

  renderWithProviders(
    <NativeQueryEditorContextProvider value={context}>
      <ParameterDisplayConfigButton />
    </NativeQueryEditorContextProvider>,
  );

  return context;
}

describe("ParameterDisplayConfigButton", () => {
  const matchMediaSpy = jest.spyOn(window, "matchMedia");

  beforeEach(() => {
    matchMediaSpy.mockReturnValue(createMockMediaQueryList({ matches: false }));
  });

  afterEach(() => localStorage.clear());
  afterAll(() => matchMediaSpy.mockRestore());

  it("shows the configured count and saves the selected parameters", () => {
    setup();

    const trigger = screen.getByRole("button", {
      name: "Configure visible parameters",
    });
    expect(screen.getByRole("img", { hidden: true })).toHaveClass("Icon-gear");
    fireEvent.click(trigger);
    expect(screen.getByText("6 parameters, 5 selected")).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search parameters" }),
      {
        target: { value: "Parameter 5" },
      },
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("6 parameters, 6 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      JSON.parse(
        localStorage.getItem("metabase.query-editor.visible-parameters:1") ??
          "null",
      ),
    ).toEqual(parameters.map(({ slug }) => slug));
  });

  it("stores display groups independently from parameter visibility", () => {
    setup();

    const trigger = screen.getByRole("button", {
      name: "Configure visible parameters",
    });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("tab", { name: "Group configuration" }));
    expect(screen.getByText("6 groups, 0 selected")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByText("6 groups, 1 selected")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("tab", { name: "Parameter configuration" }),
    );
    expect(screen.getByText("6 parameters, 5 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(readVisibleGroupSlugs(1)).toEqual(["parameter-1"]);
    expect(
      localStorage.getItem("metabase.query-editor.visible-groups:1"),
    ).toBeNull();
  });

  it("does not update the SQL when group selection is cancelled", () => {
    const context = setup();

    fireEvent.click(
      screen.getByRole("button", { name: "Configure visible parameters" }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Group configuration" }));
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(context.setDatasetQuery).not.toHaveBeenCalled();
    expect(
      localStorage.getItem("metabase.query-editor.visible-groups:1"),
    ).toBeNull();
  });

  it("closes when the trigger is clicked again", () => {
    setup();
    const trigger = screen.getByRole("button", {
      name: "Configure visible parameters",
    });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the configuration entry available while the editor is open", () => {
    setup(true);
    const trigger = screen.getByRole("button", {
      name: "Configure visible parameters",
    });
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByText("6 parameters, 5 selected")).toBeInTheDocument();
  });
});
