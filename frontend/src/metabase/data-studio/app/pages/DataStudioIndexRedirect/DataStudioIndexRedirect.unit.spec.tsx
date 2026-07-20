import fetchMock from "fetch-mock";

import {
  setupNullGetUserKeyValueEndpoints,
  setupUserKeyValueEndpoints,
} from "__support__/server-mocks";
import { renderWithProviders, screen, waitFor } from "__support__/ui";
import { Route } from "metabase/router";
import * as Urls from "metabase/urls";

import { DataStudioIndexRedirect } from "./DataStudioIndexRedirect";

function setupKeyValues({
  lastTopLevelRoute,
}: {
  lastTopLevelRoute?: string;
} = {}) {
  if (lastTopLevelRoute == null) {
    setupNullGetUserKeyValueEndpoints();
    return;
  }

  setupUserKeyValueEndpoints({
    namespace: "data_studio",
    key: "lastTopLevelRoute",
    value: lastTopLevelRoute,
  });
}

function setup() {
  return renderWithProviders(
    <Route path="/data-studio" component={DataStudioIndexRedirect} />,
    {
      withRouter: true,
      initialRoute: "/data-studio",
    },
  );
}

describe("DataStudioIndexRedirect", () => {
  beforeEach(() => {
    fetchMock.removeRoutes();
    fetchMock.clearHistory();
  });

  it("redirects to the guide when there is no saved route", async () => {
    setupKeyValues();
    const { history } = setup();

    await waitFor(() => {
      expect(history?.getCurrentLocation().pathname).toBe(
        Urls.dataStudioGuide(),
      );
    });
  });

  it("redirects returning visitors to their last top-level route", async () => {
    setupKeyValues({ lastTopLevelRoute: Urls.dataStudioData() });
    const { history } = setup();

    await waitFor(() => {
      expect(history?.getCurrentLocation().pathname).toBe(
        Urls.dataStudioData(),
      );
    });
  });

  it("shows a loading state while redirect preferences are loading", () => {
    setupKeyValues();
    setup();

    expect(screen.getByLabelText("Loading Data Studio")).toBeInTheDocument();
  });
});
