import { openUrl } from "metabase/redux/app";
import type { Dispatch, GetState } from "metabase/redux/store";
import {
  createMockDashboardState,
  createMockState,
  createMockStoreDashboard,
} from "metabase/redux/store/mocks";
import {
  createMockCard,
  createMockDashboardCard,
} from "metabase-types/api/mocks";

import { getNewCardUrl } from "./getNewCardUrl";
import { navigateToNewCardFromDashboard } from "./navigation";

jest.mock("metabase/redux/app", () => ({
  openUrl: jest.fn((url, options) => ({
    type: "mock-open-url",
    payload: { url, options },
  })),
}));

jest.mock("./getNewCardUrl", () => ({
  getNewCardUrl: jest.fn(() => "/question/2"),
}));

describe("navigateToNewCardFromDashboard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("opens dashboard drill-through URLs in a new tab", async () => {
    const previousCard = createMockCard({ id: 1 });
    const nextCard = createMockCard({ id: 2 });
    const dashcard = createMockDashboardCard({
      id: 10,
      card_id: previousCard.id,
      card: previousCard,
    });
    // jest.fn() does not infer the Dispatch function signature, so we cast it to a mocked Dispatch.
    const dispatch = jest.fn() as jest.MockedFunction<Dispatch>;
    const getState: GetState = () =>
      createMockState({
        dashboard: createMockDashboardState({
          dashboardId: 1,
          dashboards: {
            1: createMockStoreDashboard({
              id: 1,
              dashcards: [dashcard.id],
              parameters: [],
            }),
          },
          parameterValues: {},
        }),
      });

    await navigateToNewCardFromDashboard({
      nextCard,
      previousCard,
      dashcard,
    })(dispatch, getState);

    expect(getNewCardUrl).toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith("/question/2", { blank: true });
    expect(dispatch).toHaveBeenCalledWith({
      type: "mock-open-url",
      payload: {
        url: "/question/2",
        options: { blank: true },
      },
    });
  });
});
