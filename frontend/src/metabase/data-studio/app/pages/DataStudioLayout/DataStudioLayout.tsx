import cx from "classnames";
import { type ReactNode, useState } from "react";
import { t } from "ttag";

import DataStudioLogo from "assets/img/data-studio-logo.svg";
import { ForwardRefLink } from "metabase/common/components/Link";
import { UpsellGem } from "metabase/common/components/upsells/components/UpsellGem";
import { useHasTokenFeature, useSetting } from "metabase/common/hooks";
import { useUserKeyValue } from "metabase/common/hooks/use-user-key-value";
import { useRegisterShortcut } from "metabase/palette/hooks/useRegisterShortcut";
import {
  PLUGIN_FEATURE_LEVEL_PERMISSIONS,
  PLUGIN_REMOTE_SYNC,
  PLUGIN_WORKSPACES,
} from "metabase/plugins";
import { useSelector } from "metabase/redux";
import { Outlet } from "metabase/router";
import { getLocation } from "metabase/selectors/routing";
import { canAccessTransforms as canAccessTransformsSelector } from "metabase/transforms/selectors";
import {
  ActionIcon,
  Box,
  Center,
  FixedSizeIcon,
  Flex,
  Group,
  Loader,
  Stack,
  type StackProps,
  Text,
  Tooltip,
} from "metabase/ui";
import * as Urls from "metabase/urls";
import { isMac } from "metabase/utils/browser";
import type { IconName } from "metabase-types/api";

import S from "./DataStudioLayout.module.css";
import { useDataStudioRoutePersistence } from "./useDataStudioRoutePersistence";
import { getCurrentTab } from "./utils";

export function DataStudioLayout() {
  const {
    value: _isNavbarOpened,
    setValue: setIsNavbarOpened,
    isLoading: isLoadingNavbarKey,
  } = useUserKeyValue({
    namespace: "data_studio",
    key: "isNavbarOpened",
  });
  const isNavbarOpened = _isNavbarOpened !== false;

  useRegisterShortcut(
    [
      {
        id: "toggle-navbar",
        perform: () => setIsNavbarOpened(!isNavbarOpened),
      },
    ],
    [isNavbarOpened],
  );

  useDataStudioRoutePersistence();

  return isLoadingNavbarKey ? (
    <Center h="100%">
      <Loader />
    </Center>
  ) : (
    <Flex h="100%">
      <DataStudioNav
        isNavbarOpened={isNavbarOpened}
        onNavbarToggle={setIsNavbarOpened}
      />
      <Box h="100%" flex={1} miw={0}>
        <Outlet />
      </Box>
    </Flex>
  );
}

type DataStudioNavProps = {
  isNavbarOpened: boolean;
  onNavbarToggle: (isOpened: boolean) => void;
};

function DataStudioNav({ isNavbarOpened, onNavbarToggle }: DataStudioNavProps) {
  const { pathname } = useSelector(getLocation);
  const canAccessDataModel = useSelector(
    PLUGIN_FEATURE_LEVEL_PERMISSIONS.canAccessDataModel,
  );
  const canAccessTransforms = useSelector(canAccessTransformsSelector);
  const canManageWorkspaces = useSelector(
    PLUGIN_WORKSPACES.canManageWorkspaces,
  );
  const hasDirtyChanges = PLUGIN_REMOTE_SYNC.useHasLibraryDirtyChanges();
  const hasTransformDirtyChanges =
    PLUGIN_REMOTE_SYNC.useHasTransformDirtyChanges();
  const [isGitSettingsOpen, setIsGitSettingsOpen] = useState(false);

  const hasLibraryFeature = useHasTokenFeature("library");
  const hasDependenciesFeature = useHasTokenFeature("dependencies");
  const hasSchemaViewerFeature = useHasTokenFeature("schema-viewer");
  const hasRemoteSyncFeature = useHasTokenFeature("remote_sync");

  const isTransformsSetupComplete = useSetting("transforms-setup-complete");
  const areTransformsEnabled = useSetting("transforms-enabled");

  const canUseTransforms = canAccessTransforms && areTransformsEnabled;
  // if transform setup isn't complete, we still show transforms - that's where the upsell/enable pages are
  const shouldShowTransforms = canUseTransforms || !isTransformsSetupComplete;

  const currentTab = getCurrentTab(pathname);

  return (
    <>
      <Stack
        className={cx(S.nav, { [S.opened]: isNavbarOpened })}
        h="100%"
        p="0.75rem"
        data-testid="data-studio-nav"
      >
        <Stack className={S.navSections} gap={0}>
          <DataStudioNavbarToggle
            isNavbarOpened={isNavbarOpened}
            onNavbarToggle={onNavbarToggle}
          />

          <NavSection mt="md">
            <DataStudioTab
              label={t`Guide`}
              icon="book_open"
              to={Urls.dataStudioGuide()}
              isSelected={currentTab === "guide"}
              showLabel={isNavbarOpened}
            />
          </NavSection>

          <NavSection heading={t`Data`} showHeading={isNavbarOpened}>
            {canAccessDataModel && (
              <DataStudioTab
                label={t`Connected data`}
                icon="database"
                to={Urls.dataStudioData()}
                isSelected={currentTab === "data"}
                showLabel={isNavbarOpened}
              />
            )}
            {shouldShowTransforms && (
              <DataStudioTab
                label={t`Data transformation`}
                icon="transform"
                to={Urls.transformList()}
                isSelected={currentTab === "transforms"}
                showLabel={isNavbarOpened}
                rightSection={
                  hasTransformDirtyChanges &&
                  PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge ? (
                    <PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge />
                  ) : null
                }
              />
            )}
          </NavSection>

          <NavSection heading={t`Library`} showHeading={isNavbarOpened}>
            <DataStudioTab
              label={t`Semantic layer`}
              icon="repository"
              to={Urls.dataStudioLibrary()}
              isSelected={currentTab === "library"}
              showLabel={isNavbarOpened}
              isGated={!hasLibraryFeature}
              rightSection={
                hasDirtyChanges &&
                PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge ? (
                  <PLUGIN_REMOTE_SYNC.CollectionSyncStatusBadge />
                ) : null
              }
            />
            <DataStudioTab
              label={t`Glossary`}
              icon="glossary"
              to={Urls.dataStudioGlossary()}
              isSelected={currentTab === "glossary"}
              showLabel={isNavbarOpened}
            />
          </NavSection>

          <NavSection heading={t`Tools`} showHeading={isNavbarOpened}>
            <DataStudioTab
              label={t`Schema viewer`}
              icon="network"
              to={Urls.dataStudioSchemaViewer()}
              isSelected={currentTab === "schema-viewer"}
              showLabel={isNavbarOpened}
              isGated={!hasSchemaViewerFeature}
            />
            <DataStudioTab
              label={t`Dependency graph`}
              icon="dependencies"
              to={Urls.dependencyGraph()}
              isSelected={currentTab === "dependencies"}
              showLabel={isNavbarOpened}
              isGated={!hasDependenciesFeature}
            />
            <DataStudioTab
              label={t`Dependency diagnostics`}
              icon="search_check"
              to={Urls.dependencyDiagnostics()}
              isSelected={currentTab === "dependency-diagnostics"}
              showLabel={isNavbarOpened}
              isGated={!hasDependenciesFeature}
            />
          </NavSection>
        </Stack>

        <NavSection className={S.navFooter} mb={0}>
          {hasRemoteSyncFeature ? (
            <PLUGIN_REMOTE_SYNC.GitSyncSetupMenuItem
              isNavbarOpened={isNavbarOpened}
              onClick={() => setIsGitSettingsOpen(true)}
            />
          ) : (
            <DataStudioTab
              label={t`Remote sync`}
              icon="gear"
              to={Urls.dataStudioGitSync()}
              isSelected={currentTab === "git-sync"}
              showLabel={isNavbarOpened}
              isGated
            />
          )}
          {canManageWorkspaces && (
            <DataStudioTab
              label={t`Workspaces`}
              icon="workspace"
              to={Urls.workspaces()}
              isSelected={currentTab === "workspaces"}
              showLabel={isNavbarOpened}
            />
          )}
        </NavSection>
        <PLUGIN_REMOTE_SYNC.GitSettingsModal
          isOpen={isGitSettingsOpen}
          onClose={() => setIsGitSettingsOpen(false)}
        />
      </Stack>
    </>
  );
}

type NavSectionProps = {
  children: ReactNode;
  className?: string;
  heading?: string;
  showHeading?: boolean;
} & StackProps;

function NavSection({
  children,
  className,
  heading,
  showHeading,
  ...rest
}: NavSectionProps) {
  return (
    <Stack className={cx(className)} gap={0} mb="lg" {...rest}>
      {showHeading && heading != null && (
        <Text
          fz="xs"
          fw="bold"
          tt="uppercase"
          c="text-secondary"
          className={S.sectionHeading}
        >
          {heading}
        </Text>
      )}
      {children}
    </Stack>
  );
}

type DataStudioTabProps = {
  label: string;
  icon: IconName;
  to: string;
  isSelected?: boolean;
  showLabel: boolean;
  rightSection?: ReactNode;
  isGated?: boolean;
};

const TOOLTIP_OPEN_DELAY = 1000;

function DataStudioTab({
  label,
  icon,
  to,
  isSelected,
  showLabel,
  rightSection,
  isGated,
}: DataStudioTabProps) {
  const upsellGem = isGated ? <UpsellGem.New size={14} /> : null;
  const effectiveRightSection = rightSection ?? upsellGem;

  return (
    <Tooltip
      label={label}
      position="right"
      openDelay={TOOLTIP_OPEN_DELAY}
      disabled={showLabel}
    >
      <Flex
        className={cx(S.tab, { [S.selected]: isSelected })}
        component={ForwardRefLink}
        to={to}
        p="sm"
        gap="sm"
        bdrs="md"
        aria-label={label}
        justify={showLabel ? "start" : "center"}
      >
        <FixedSizeIcon name={icon} display="block" className={S.icon} />
        {showLabel && <Text lh="sm">{label}</Text>}
        {effectiveRightSection && (
          <Box
            className={showLabel ? undefined : S.badgeOverlay}
            ml={showLabel ? "auto" : undefined}
          >
            {effectiveRightSection}
          </Box>
        )}
      </Flex>
    </Tooltip>
  );
}

const getSidebarTooltipLabel = (isNavbarOpened: boolean) => {
  const message = isNavbarOpened ? t`Close sidebar` : t`Open sidebar`;
  const shortcut = isMac() ? "(⌘ + .)" : "(Ctrl + .)";
  return `${message} ${shortcut}`;
};

type DataStudioNavbarToggleProps = {
  isNavbarOpened: boolean;
  onNavbarToggle: (isOpened: boolean) => void;
};

function DataStudioNavbarToggle({
  isNavbarOpened,
  onNavbarToggle,
}: DataStudioNavbarToggleProps) {
  return (
    <Flex
      align="center"
      justify={isNavbarOpened ? "space-between" : "center"}
      mb="0.75rem"
      mt="sm"
    >
      <Group gap="sm">
        <Box
          className={cx(S.logoWrapper, { [S.navbarClosed]: !isNavbarOpened })}
        >
          <img
            alt={t`Data Studio Logo`}
            className={S.logo}
            src={DataStudioLogo}
          />
          {!isNavbarOpened && (
            <ToggleActionIcon
              isNavbarOpened={isNavbarOpened}
              onNavbarToggle={onNavbarToggle}
            />
          )}
        </Box>
        {isNavbarOpened && <PLUGIN_REMOTE_SYNC.GitSyncAppBarControls />}
      </Group>
      {isNavbarOpened && (
        <ToggleActionIcon isNavbarOpened onNavbarToggle={onNavbarToggle} />
      )}
    </Flex>
  );
}

type ToggleActionIconProps = DataStudioNavbarToggleProps & {
  className?: string;
};

function ToggleActionIcon(props: ToggleActionIconProps) {
  const { isNavbarOpened, onNavbarToggle } = props;
  const label = getSidebarTooltipLabel(isNavbarOpened);

  return (
    <Tooltip label={label} openDelay={1000}>
      <ActionIcon
        aria-label={label}
        className={S.toggle}
        onClick={() => onNavbarToggle(!isNavbarOpened)}
      >
        <FixedSizeIcon
          name={isNavbarOpened ? "sidebar_closed" : "sidebar_open"}
          c="text-secondary"
        />
      </ActionIcon>
    </Tooltip>
  );
}
