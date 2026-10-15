import cx from "classnames";
import { useCallback, useEffect, useMemo, useState } from "react";
import { msgid, ngettext, t } from "ttag";

import { useIsSmallScreen } from "metabase/common/hooks/use-is-small-screen";
import { ActionIcon, Box, Button, Flex, Icon } from "metabase/ui";
import type { CardId, DashboardId, Parameter } from "metabase-types/api";

import ResponsiveParametersListS from "./ResponsiveParametersList.module.css";
import { SyncedParametersList } from "./SyncedParametersList";
import {
  PARAMETER_DISPLAY_CONFIG_EVENT,
  getDefaultVisibleParameterSlugs,
  readVisibleParameterSlugs,
} from "./parameter-display-config";

interface ResponsiveParametersListProps {
  classNames?: {
    container?: string;
    parametersList?: string;
  };
  cardId?: CardId;
  dashboardId?: DashboardId;
  parameters: Parameter[];
  setParameterValue: (parameterId: string, value: string) => void;
  setParameterIndex?: (parameterId: string, parameterIndex: number) => void;
  enableParameterRequiredBehavior: boolean;
  commitImmediately?: boolean;
  isSortable?: boolean;
  showAllParameters?: boolean;
}

export const ResponsiveParametersList = ({
  classNames,
  cardId,
  dashboardId,
  parameters,
  setParameterValue,
  setParameterIndex,
  enableParameterRequiredBehavior,
  commitImmediately = true,
  isSortable,
  showAllParameters = false,
}: ResponsiveParametersListProps) => {
  const [mobileShowParameterList, setShowMobileParameterList] = useState(false);
  const [visibleParameterSlugs, setVisibleParameterSlugs] = useState<string[]>(
    () => getDefaultVisibleParameterSlugs(parameters.map(({ slug }) => slug)),
  );
  const isSmallScreen = useIsSmallScreen();
  const parameterSlugKey = parameters.map(({ slug }) => slug).join("\u0000");
  const parameterSlugs = useMemo(
    () => (parameterSlugKey ? parameterSlugKey.split("\u0000") : []),
    [parameterSlugKey],
  );

  useEffect(() => {
    if (parameters.length === 0) {
      return;
    }

    const storedSlugs = readVisibleParameterSlugs(cardId);
    const nextVisibleSlugs = storedSlugs
      ? storedSlugs.filter((slug) => parameterSlugs.includes(slug))
      : getDefaultVisibleParameterSlugs(parameterSlugs);

    setVisibleParameterSlugs(nextVisibleSlugs);
  }, [cardId, parameterSlugs, parameters.length]);

  useEffect(() => {
    const handleConfigChange = (event: Event) => {
      // This listener handles only events emitted by saveVisibleParameterSlugs.
      const { detail } = event as CustomEvent<{
        cardId?: CardId;
        slugs: string[];
      }>;
      if (detail.cardId === cardId) {
        setVisibleParameterSlugs(
          detail.slugs.filter((slug) => parameterSlugs.includes(slug)),
        );
      }
    };
    window.addEventListener(PARAMETER_DISPLAY_CONFIG_EVENT, handleConfigChange);
    return () =>
      window.removeEventListener(
        PARAMETER_DISPLAY_CONFIG_EVENT,
        handleConfigChange,
      );
  }, [cardId, parameterSlugs]);

  const handleFilterButtonClick = useCallback(() => {
    setShowMobileParameterList((mobileShow) => !mobileShow);
  }, []);

  const activeFilters = useMemo(() => {
    return parameters.filter((p) => !!p.value).length;
  }, [parameters]);

  const hiddenParameterSlugs = useMemo(
    () =>
      parameters
        .filter((parameter) => !visibleParameterSlugs.includes(parameter.slug))
        .map((parameter) => parameter.slug)
        .join(","),
    [parameters, visibleParameterSlugs],
  );

  return (
    <Box
      w={isSmallScreen && mobileShowParameterList ? "100%" : undefined}
      style={{ alignSelf: "center" }}
    >
      {parameters.length > 0 && isSmallScreen && (
        <Button
          m="sm"
          variant="subtle"
          leftSection={<Icon name="filter" />}
          onClick={handleFilterButtonClick}
        >
          {activeFilters > 0
            ? ngettext(
                msgid`${activeFilters} active filter`,
                `${activeFilters} active filters`,
                activeFilters,
              )
            : `Filters`}
        </Button>
      )}
      <Box
        className={cx(
          ResponsiveParametersListS.ParametersListContainer,
          {
            [ResponsiveParametersListS.isSmallScreen]: isSmallScreen,
            [ResponsiveParametersListS.isShowingMobile]:
              mobileShowParameterList,
          },
          classNames?.container,
        )}
      >
        {parameters.length > 0 && isSmallScreen && (
          <Flex p="0.75rem 1rem" align="center" justify="space-between">
            <h3>{t`Filters`}</h3>
            <ActionIcon
              variant="viewHeader"
              aria-label={t`Close`}
              onClick={handleFilterButtonClick}
            >
              <Icon name="close" />
            </ActionIcon>
          </Flex>
        )}
        <Flex align="center" gap="sm" px="sm" py="sm" wrap="wrap">
          <SyncedParametersList
            className={cx(
              ResponsiveParametersListS.StyledParametersList,
              classNames?.parametersList,
            )}
            cardId={cardId}
            dashboardId={dashboardId}
            parameters={parameters}
            hideParameters={
              isSmallScreen || showAllParameters
                ? undefined
                : hiddenParameterSlugs
            }
            setParameterValue={setParameterValue}
            setParameterIndex={setParameterIndex}
            enableParameterRequiredBehavior={enableParameterRequiredBehavior}
            isEditing
            isSortable={isSortable}
            commitImmediately={commitImmediately}
          />
        </Flex>
      </Box>
    </Box>
  );
};
