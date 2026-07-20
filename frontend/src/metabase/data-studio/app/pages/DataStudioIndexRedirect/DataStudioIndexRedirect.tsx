import { useEffect } from "react";
import { t } from "ttag";

import { useUserKeyValue } from "metabase/common/hooks/use-user-key-value";
import { useDispatch } from "metabase/redux";
import { replace } from "metabase/router";
import { Center, Loader } from "metabase/ui";
import * as Urls from "metabase/urls";

export function DataStudioIndexRedirect() {
  const dispatch = useDispatch();
  const { value: lastTopLevelRoute, isLoading } = useUserKeyValue({
    namespace: "data_studio",
    key: "lastTopLevelRoute",
    defaultValue: Urls.dataStudioGuide(),
  });

  useEffect(() => {
    if (isLoading) {
      return;
    }

    dispatch(replace(lastTopLevelRoute));
  }, [dispatch, isLoading, lastTopLevelRoute]);

  return (
    <Center h="100%" aria-label={t`Loading Data Studio`}>
      <Loader />
    </Center>
  );
}
