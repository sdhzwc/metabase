import { act } from "@testing-library/react";

import {
  createMockMediaQueryList,
  renderWithProviders,
  screen,
} from "__support__/ui";
import type { CardId, Parameter } from "metabase-types/api";
import { createMockParameter } from "metabase-types/api/mocks";

import { ResponsiveParametersList } from "./ResponsiveParametersList";
import { saveVisibleParameterSlugs } from "./parameter-display-config";

type SetupOpts = {
  cardId?: CardId;
  parameters?: Parameter[];
  enableParameterRequiredBehavior?: boolean;
  showAllParameters?: boolean;
};

function setup({
  cardId,
  parameters = [],
  enableParameterRequiredBehavior = false,
  showAllParameters = false,
}: SetupOpts) {
  const setParameterValue = jest.fn();
  const setParameterIndex = jest.fn();

  renderWithProviders(
    <ResponsiveParametersList
      cardId={cardId}
      parameters={parameters}
      enableParameterRequiredBehavior={enableParameterRequiredBehavior}
      setParameterValue={setParameterValue}
      setParameterIndex={setParameterIndex}
      showAllParameters={showAllParameters}
    />,
  );

  return { setParameterValue, setParameterIndex };
}

describe("ResponsiveParametersList", () => {
  const matchMediaSpy = jest.spyOn(window, "matchMedia");

  afterEach(() => {
    matchMediaSpy.mockRestore();
    localStorage.clear();
  });

  describe("small screens", () => {
    beforeEach(() => {
      matchMediaSpy.mockReturnValue(
        createMockMediaQueryList({ matches: true }),
      );
    });

    it("should show the filter button when there are parameters", () => {
      setup({ parameters: [createMockParameter()] });
      expect(
        screen.getByRole("button", { name: /Filters/ }),
      ).toBeInTheDocument();
    });

    it("should not show the filter button when there are no parameters", () => {
      setup({ parameters: [] });
      expect(
        screen.queryByRole("button", { name: /Filters/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("large screens", () => {
    beforeEach(() => {
      matchMediaSpy.mockReturnValue(
        createMockMediaQueryList({ matches: false }),
      );
    });

    it("should not show the filter button for small screens when there are parameters", () => {
      setup({ parameters: [createMockParameter()] });
      expect(
        screen.queryByRole("button", { name: /Filters/ }),
      ).not.toBeInTheDocument();
    });

    it("collapses parameters beyond the default five", () => {
      const parameters = Array.from({ length: 6 }, (_, index) =>
        createMockParameter({
          id: `${index}`,
          name: `Parameter ${index}`,
          slug: `parameter-${index}`,
        }),
      );

      setup({ cardId: 1, parameters });

      expect(screen.getAllByTestId("parameter-widget")).toHaveLength(5);
      expect(screen.queryByText("Parameters (6)")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /more parameters/ }),
      ).not.toBeInTheDocument();
    });

    it("updates the collapsed count when the display configuration is saved", () => {
      const parameters = Array.from({ length: 5 }, (_, index) =>
        createMockParameter({
          id: `${index}`,
          name: `Parameter ${index}`,
          slug: `parameter-${index}`,
        }),
      );

      setup({ cardId: 1, parameters });
      act(() => {
        saveVisibleParameterSlugs(1, ["parameter-1", "parameter-3"]);
      });

      expect(screen.getAllByTestId("parameter-widget")).toHaveLength(2);
      expect(
        JSON.parse(
          localStorage.getItem("metabase.query-editor.visible-parameters:1") ??
            "null",
        ),
      ).toEqual(["parameter-1", "parameter-3"]);
    });

    it("keeps the editor parameter list aligned with the saved configuration", () => {
      const parameters = Array.from({ length: 6 }, (_, index) =>
        createMockParameter({
          id: `${index}`,
          name: `Parameter ${index}`,
          slug: `parameter-${index}`,
        }),
      );
      saveVisibleParameterSlugs(1, ["parameter-0"]);

      setup({ cardId: 1, parameters });

      expect(screen.getAllByTestId("parameter-widget")).toHaveLength(1);
    });
  });
});
