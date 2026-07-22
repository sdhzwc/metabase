import userEvent from "@testing-library/user-event";

import { fireEvent, render, screen } from "__support__/ui";

import { DateSingleWidget } from "./DateSingleWidget";

type SetupOpts = {
  value?: string;
};

function setup({ value }: SetupOpts = {}) {
  const onChange = jest.fn();
  render(<DateSingleWidget value={value} onChange={onChange} />);
  return { onChange };
}

describe("DateSingleWidget", () => {
  it("should allow to select a date", async () => {
    const { onChange } = setup();
    const input = screen.getByLabelText("Date");
    await userEvent.clear(input);
    await userEvent.type(input, "Feb 15, 2020");
    await userEvent.click(screen.getByText("Apply"));
    expect(onChange).toHaveBeenCalledWith("2020-02-15");
  });

  it("should accept a previously selected date", async () => {
    setup({ value: "2020-02-15" });
    expect(screen.getByText("February 2020")).toBeInTheDocument();
  });

  it("should position a dynamic single date default on its concrete date", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 22, 12, 30));

    try {
      const { onChange } = setup({ value: "past1days-from-1days" });

      expect(screen.getByLabelText("Date")).toHaveValue("July 20, 2026");

      fireEvent.click(screen.getByText("Apply"));
      expect(onChange).toHaveBeenCalledWith("2026-07-20");
    } finally {
      jest.useRealTimers();
    }
  });

  it("should position a dynamic date template on its concrete date", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 22, 12, 30));

    try {
      const { onChange } = setup({
        value: "date-template:%Y%m26 + 1 month - 2 days",
      });

      expect(screen.getByLabelText("Date")).toHaveValue("August 24, 2026");

      fireEvent.click(screen.getByText("Apply"));
      expect(onChange).toHaveBeenCalledWith("2026-08-24");
    } finally {
      jest.useRealTimers();
    }
  });
});
