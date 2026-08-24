import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen } from "__support__/ui";
import type {
  ArbitraryCustomDestinationClickBehavior,
  ClickBehavior,
} from "metabase-types/api";
import { createMockDashboardCard } from "metabase-types/api/mocks";

import { LinkOptions } from "./LinkOptions";

function setup({
  clickBehavior = {
    type: "link",
    linkType: "url",
    linkTemplate: "https://example.com",
  },
}: {
  clickBehavior?: ArbitraryCustomDestinationClickBehavior;
} = {}) {
  const updateSettings = jest.fn<void, [Partial<ClickBehavior>]>();

  renderWithProviders(
    <LinkOptions
      clickBehavior={clickBehavior}
      dashcard={createMockDashboardCard()}
      parameters={[]}
      updateSettings={updateSettings}
    />,
  );

  return { clickBehavior, updateSettings };
}

describe("LinkOptions", () => {
  it("should let link click behaviors open in a new tab", async () => {
    const { clickBehavior, updateSettings } = setup();

    const switchControl = screen.getByRole("switch", {
      name: /open in new tab/i,
    });

    expect(switchControl).not.toBeChecked();

    await userEvent.click(switchControl);

    expect(updateSettings).toHaveBeenCalledWith({
      ...clickBehavior,
      blank: true,
    });
  });
});
