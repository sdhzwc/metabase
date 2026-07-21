import { DependencyDiagnosticsSectionLayout } from "metabase/monitor/dependency-diagnostics/DependencyDiagnosticsSectionLayout";
import { DependencyDiagnosticsUpsellPage } from "metabase/monitor/dependency-diagnostics/DependencyDiagnosticsUpsellPage";
import {
  PLUGIN_DEPENDENCIES,
  PLUGIN_LIBRARY,
  PLUGIN_SCHEMA_VIEWER,
  PLUGIN_WORKSPACES,
} from "metabase/plugins";
import {
  Route,
  type RouteComponent,
  redirect,
  withRouteProps,
} from "metabase/router";
import { getDataStudioTransformRoutes } from "metabase/transforms/routes";
import * as Urls from "metabase/urls";

import { DataSectionLayout } from "./app/pages/DataSectionLayout";
import { DataStudioLayout } from "./app/pages/DataStudioLayout";
import { DependenciesSectionLayout } from "./app/pages/DependenciesSectionLayout";
import { GitSyncSectionLayout } from "./app/pages/GitSyncSectionLayout";
import { TransformsSectionLayout } from "./app/pages/TransformsSectionLayout";
import { WorkspacesSectionLayout } from "./app/pages/WorkspacesSectionLayout";
import { getDataStudioMetadataRoutes } from "./data-model/routes";
import { getDataStudioGlossaryRoutes } from "./glossary/routes";
import { GuidePage } from "./guide/pages/GuidePage/GuidePage";
import { getDataStudioSettingsRoutes } from "./settings/routes";
import {
  DependenciesUpsellPage,
  LibraryUpsellPage,
  SchemaViewerUpsellPage,
} from "./upsells/pages";

const RoutedTransformsSectionLayout = withRouteProps(TransformsSectionLayout);

export function getDataStudioRoutes(
  CanAccessDataStudio: RouteComponent,
  CanAccessDataModel: RouteComponent,
  IsAdmin: RouteComponent,
) {
  return (
    <Route element={<CanAccessDataStudio />}>
      <Route path="data-studio" element={<DataStudioLayout />}>
        <Route index element={redirect(Urls.dataStudioGuide())} />
        <Route path="guide" element={<GuidePage />} />
        <Route path="data" element={<CanAccessDataModel />}>
          <Route element={<DataSectionLayout />}>
            {getDataStudioMetadataRoutes(IsAdmin)}
          </Route>
        </Route>
        <Route path="transforms" element={<RoutedTransformsSectionLayout />}>
          {getDataStudioTransformRoutes()}
        </Route>
        <Route element={<WorkspacesSectionLayout />}>
          {PLUGIN_WORKSPACES.getDataStudioRoutes()}
        </Route>
        {getDataStudioGlossaryRoutes()}
        {getDataStudioSettingsRoutes()}
        {PLUGIN_LIBRARY.isEnabled ? (
          PLUGIN_LIBRARY.getDataStudioLibraryRoutes(IsAdmin)
        ) : (
          <Route path="library" element={<LibraryUpsellPage />} />
        )}
        {PLUGIN_DEPENDENCIES.isEnabled ? (
          <Route path="dependencies" element={<DependenciesSectionLayout />}>
            {PLUGIN_DEPENDENCIES.getDataStudioDependencyRoutes()}
          </Route>
        ) : (
          <Route path="dependencies" element={<DependenciesUpsellPage />} />
        )}
        {PLUGIN_DEPENDENCIES.isEnabled ? (
          <Route
            path="dependency-diagnostics"
            element={<DependencyDiagnosticsSectionLayout />}
          >
            {PLUGIN_DEPENDENCIES.getDataStudioDependencyDiagnosticsRoutes()}
          </Route>
        ) : (
          <Route
            path="dependency-diagnostics"
            element={<DependencyDiagnosticsUpsellPage />}
          />
        )}
        {PLUGIN_SCHEMA_VIEWER.isEnabled ? (
          <Route path="schema-viewer">
            {PLUGIN_SCHEMA_VIEWER.getDataStudioSchemaViewerRoutes()}
          </Route>
        ) : (
          <Route path="schema-viewer" element={<SchemaViewerUpsellPage />} />
        )}
        <Route path="git-sync" element={<GitSyncSectionLayout />} />
      </Route>
    </Route>
  );
}
