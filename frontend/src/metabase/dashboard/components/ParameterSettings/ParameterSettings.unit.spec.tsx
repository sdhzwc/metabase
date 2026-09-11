import userEvent from "@testing-library/user-event";

import { act, renderWithProviders, screen } from "__support__/ui";
import { createMockUiParameter } from "metabase-lib/v1/parameters/mock";
import type { UiParameter } from "metabase-lib/v1/parameters/types";

import { ParameterSettings } from "../ParameterSettings";

interface SetupOpts {
  parameter?: UiParameter;
}

async function fillValue(input: HTMLElement, value: string) {
  await userEvent.clear(input);
  if (value.length) {
    await userEvent.type(input, value);
  }
}

describe("ParameterSidebar", () => {
  it("should allow to change source settings for string parameters", async () => {
    const { onChangeQueryType } = setup({
      parameter: createMockUiParameter({
        type: "string/=",
        sectionId: "string",
      }),
    });

    await userEvent.click(screen.getByRole("radio", { name: "Search box" }));

    expect(onChangeQueryType).toHaveBeenCalledWith("search");
  });

  it("should not update the label if the input is blank", async () => {
    const { onChangeName } = setup({
      parameter: createMockUiParameter({
        name: "foo",
        type: "string/=",
        sectionId: "string",
      }),
    });
    const labelInput = screen.getByLabelText("Label");
    expect(labelInput).toHaveValue("foo");
    await fillValue(labelInput, "");
    // expect there to be an error message with the text "Required"
    expect(screen.getByText(/required/i)).toBeInTheDocument();
    act(() => {
      labelInput.blur();
    });
    // when the input blurs, the value should have reverted to the original
    expect(onChangeName).not.toHaveBeenCalled();
    expect(labelInput).toHaveValue("foo");
    // the error message should disappear
    expect(screen.queryByText(/required/i)).not.toBeInTheDocument();

    // sanity check with a non-blank value
    await fillValue(labelInput, "bar");
    act(() => {
      labelInput.blur();
    });
    expect(onChangeName).toHaveBeenCalledWith("bar");
    expect(labelInput).toHaveValue("bar");
  });

  it("should not update the label if the input is any variation of the word 'tab'", async () => {
    const { onChangeName } = setup({
      parameter: createMockUiParameter({
        name: "foo",
        type: "string/=",
        sectionId: "string",
      }),
    });
    const labelInput = screen.getByLabelText("Label");
    expect(labelInput).toHaveValue("foo");
    await fillValue(labelInput, "tAb");
    // expect there to be an error message with the text "reserved"
    expect(screen.getByText(/reserved/i)).toBeInTheDocument();
    act(() => {
      labelInput.blur();
    });
    // when the input blurs, the value should have reverted to the original
    expect(onChangeName).not.toHaveBeenCalled();
    expect(labelInput).toHaveValue("foo");
    // the error message should disappear
    expect(screen.queryByText(/reserved/i)).not.toBeInTheDocument();

    // sanity check with a non-blank value
    await fillValue(labelInput, "bar");
    act(() => {
      labelInput.blur();
    });
    expect(onChangeName).toHaveBeenCalledWith("bar");
    expect(labelInput).toHaveValue("bar");
  });

  it("should allow to change source settings for location parameters", async () => {
    const { onChangeQueryType } = setup({
      parameter: createMockUiParameter({
        type: "string/=",
        sectionId: "location",
      }),
    });

    await userEvent.click(screen.getByRole("radio", { name: "Input box" }));

    expect(onChangeQueryType).toHaveBeenCalledWith("none");
  });

  describe("location", () => {
    beforeEach(() => {
      setup({
        parameter: createMockUiParameter({
          type: "string/=",
          sectionId: "location",
        }),
      });
    });

    it("should render type", () => {
      expect(screen.getByDisplayValue("Location")).toBeInTheDocument();
    });

    it("should render operator", () => {
      expect(screen.getByDisplayValue("Is")).toBeInTheDocument();
    });
  });

  describe("id", () => {
    beforeEach(() => {
      setup({
        parameter: createMockUiParameter({
          type: "number/=",
          sectionId: "id",
        }),
      });
    });

    it("should render type", () => {
      expect(screen.getByDisplayValue("ID")).toBeInTheDocument();
    });

    it("should render operator", () => {
      expect(screen.getByDisplayValue("Numeric ID")).toBeInTheDocument();
    });
  });

  describe("string", () => {
    describe("smoke test", () => {
      beforeEach(() => {
        setup({
          parameter: createMockUiParameter({
            type: "string/=",
            sectionId: "string",
          }),
        });
      });

      it("should render type", () => {
        expect(
          screen.getByDisplayValue("Text or Category"),
        ).toBeInTheDocument();
      });

      it("should render operator", () => {
        expect(screen.getByDisplayValue("Is")).toBeInTheDocument();
      });
    });

    it.each([
      "string/=",
      "string/!=",
      "string/contains",
      "string/does-not-contain",
      "string/starts-with",
      "string/ends-with",
    ])(
      "should be able to toggle multiple values settings for `%s` operator",
      async (type) => {
        const { onChangeIsMultiSelect } = setup({
          parameter: createMockUiParameter({
            type,
            sectionId: "string",
          }),
        });

        expect(screen.getByText("People can pick")).toBeInTheDocument();
        expect(
          screen.getByRole("radio", { name: "Multiple values" }),
        ).toBeChecked();
        await userEvent.click(
          screen.getByRole("radio", { name: "A single value" }),
        );
        expect(onChangeIsMultiSelect).toHaveBeenCalledWith(false);
      },
    );
  });

  describe("date", () => {
    it("should render type", () => {
      setup({
        parameter: createMockUiParameter({
          type: "date/single",
          sectionId: "date",
        }),
      });
      expect(screen.getByDisplayValue("Date picker")).toBeInTheDocument();
    });

    it("should render operator", () => {
      setup({
        parameter: createMockUiParameter({
          type: "date/single",
          sectionId: "date",
        }),
      });
      expect(screen.getByDisplayValue("Single Date")).toBeInTheDocument();
    });

    it("should allow to select a dynamic shortcut default for single date parameters", async () => {
      const { onChangeDefaultValue } = setup({
        parameter: createMockUiParameter({
          type: "date/single",
          sectionId: "date",
        }),
      });

      await userEvent.click(
        screen.getByRole("button", { name: "Select a default value…" }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Today" }));

      expect(onChangeDefaultValue).toHaveBeenCalledWith("thisday");
    });
  });

  describe("number", () => {
    beforeEach(() => {
      setup({
        parameter: createMockUiParameter({
          type: "number/=",
          sectionId: "number",
        }),
      });
    });

    it("should render type", () => {
      expect(screen.getByDisplayValue("Number")).toBeInTheDocument();
    });

    it("should render operator", () => {
      expect(screen.getByDisplayValue("Equal to")).toBeInTheDocument();
    });
  });

  describe("temporal-unit", () => {
    it("should not render the type or operator", async () => {
      setup({ parameter: createMockUiParameter({ type: "temporal-unit" }) });
      expect(await screen.findByText("Label")).toBeInTheDocument();
      expect(screen.queryByText("Filter type")).not.toBeInTheDocument();
      expect(screen.queryByText("Filter operator")).not.toBeInTheDocument();
    });

    it("should set available temporal units", async () => {
      const parameter = createMockUiParameter({
        type: "temporal-unit",
        temporal_units: ["day"],
      });
      const { onChangeTemporalUnits } = setup({ parameter });
      await userEvent.click(await screen.findByText("Day"));
      await userEvent.click(await screen.findByLabelText("Month"));
      expect(onChangeTemporalUnits).toHaveBeenCalledWith(["day", "month"]);
    });
  });
});

const setup = ({ parameter = createMockUiParameter() }: SetupOpts = {}) => {
  const onChangeQueryType = jest.fn();
  const onChangeName = jest.fn();
  const onChangeIsMultiSelect = jest.fn();
  const onChangeTemporalUnits = jest.fn();
  const onChangeDefaultValue = jest.fn();

  renderWithProviders(
    <ParameterSettings
      embeddedParameterVisibility={null}
      parameter={parameter}
      isParameterSlugUsed={jest.fn()}
      onChangeName={onChangeName}
      onChangeType={jest.fn()}
      onChangeDefaultValue={onChangeDefaultValue}
      onChangeIsMultiSelect={onChangeIsMultiSelect}
      onChangeQueryType={onChangeQueryType}
      onChangeSourceType={jest.fn()}
      onChangeSourceConfig={jest.fn()}
      onChangeRequired={jest.fn()}
      onChangeTemporalUnits={onChangeTemporalUnits}
      hasMapping={false}
    />,
  );

  return {
    onChangeQueryType,
    onChangeName,
    onChangeIsMultiSelect,
    onChangeTemporalUnits,
    onChangeDefaultValue,
  };
};
