import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen } from "__support__/ui";

import { DateSingleDefaultWidget } from "./DateSingleDefaultWidget";

type SetupOpts = {
  value?: string;
};

function setup({ value }: SetupOpts = {}) {
  const onChange = jest.fn();
  renderWithProviders(
    <DateSingleDefaultWidget value={value} onChange={onChange} />,
  );
  return { onChange };
}

describe("DateSingleDefaultWidget", () => {
  it("should allow to select a dynamic shortcut default", async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onChange).toHaveBeenCalledWith("thisday");

    await userEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(onChange).toHaveBeenCalledWith("past1days");

    await userEvent.click(
      screen.getByRole("button", { name: "Day before yesterday" }),
    );
    expect(onChange).toHaveBeenCalledWith("past1days-from-1days");
  });

  it("should allow to select a dynamic date template default", async () => {
    const { onChange } = setup();

    await userEvent.click(
      screen.getByRole("button", { name: "Custom dynamic date" }),
    );
    expect(screen.getByLabelText("Dynamic date template")).toHaveValue(
      "%Y%m%d",
    );

    await userEvent.clear(screen.getByLabelText("Dynamic date template"));
    await userEvent.type(
      screen.getByLabelText("Dynamic date template"),
      "%Y%m26 + 1 month - 2 days",
    );
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenCalledWith(
      "date-template:%Y%m26 + 1 month - 2 days",
    );
  });

  it("should allow to select a fixed date default", async () => {
    const { onChange } = setup();

    await userEvent.click(
      screen.getByRole("button", { name: "Custom fixed date" }),
    );

    const input = screen.getByLabelText("Date");
    await userEvent.clear(input);
    await userEvent.type(input, "Feb 15, 2020");
    await userEvent.click(screen.getByText("Apply"));

    expect(onChange).toHaveBeenCalledWith("2020-02-15");
  });
});
