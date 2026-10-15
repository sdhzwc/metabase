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
import { createMockParameter } from "metabase-types/api/mocks";

import { ParameterDisplayConfigButton } from "./ParameterDisplayConfigButton";

jest.mock("metabase/common/hooks/use-locale", () => ({
  useLocale: () => ({ locale: "en" }),
}));

const parameters = Array.from({ length: 5 }, (_, index) =>
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
    isNativeEditorOpen,
    setParameterValue: jest.fn(),
  } as unknown as NativeQueryEditorContextValue;

  renderWithProviders(
    <NativeQueryEditorContextProvider value={context}>
      <ParameterDisplayConfigButton />
    </NativeQueryEditorContextProvider>,
  );
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
    expect(screen.getByText("5 parameters, 3 selected")).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search parameters" }),
      {
        target: { value: "Parameter 4" },
      },
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("5 parameters, 4 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      JSON.parse(
        localStorage.getItem("metabase.query-editor.visible-parameters:1") ??
          "null",
      ),
    ).toEqual(["parameter-0", "parameter-1", "parameter-2", "parameter-4"]);
  });

  it("hides the configuration entry while the editor is open", () => {
    setup(true);
    expect(
      screen.queryByRole("button", { name: "Configure visible parameters" }),
    ).not.toBeInTheDocument();
  });
});
