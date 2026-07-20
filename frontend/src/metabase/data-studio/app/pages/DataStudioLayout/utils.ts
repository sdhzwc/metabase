import * as Urls from "metabase/urls";

type TabName =
  | "guide"
  | "data"
  | "library"
  | "transforms"
  | "dependencies"
  | "dependency-diagnostics"
  | "schema-viewer"
  | "glossary"
  | "git-sync"
  | "workspaces"
  | "settings";

const DATA_STUDIO_ROOT = Urls.dataStudio();

export function getDataStudioTopLevelRoute(pathname: string): string | null {
  const pathWithoutQuery = pathname.split(/[?#]/)[0];

  if (!pathWithoutQuery.startsWith(DATA_STUDIO_ROOT)) {
    return null;
  }

  const remainder = pathWithoutQuery.slice(DATA_STUDIO_ROOT.length);
  if (remainder === "" || remainder === "/") {
    return null;
  }

  const [segment] = remainder.split("/").filter(Boolean);
  if (segment == null) {
    return null;
  }

  switch (segment) {
    case "guide":
      return Urls.dataStudioGuide();
    case "data":
      return Urls.dataStudioData();
    case "transforms":
      return Urls.transformList();
    case "library":
      return Urls.dataStudioLibrary();
    case "glossary":
      return Urls.dataStudioGlossary();
    case "schema-viewer":
      return Urls.dataStudioSchemaViewer();
    case "dependencies":
      return Urls.dependencyGraph();
    case "dependency-diagnostics":
      return Urls.dependencyDiagnostics();
    case "git-sync":
      return Urls.dataStudioGitSync();
    case "workspaces":
      return Urls.workspaces();
    default:
      return null;
  }
}

export const getCurrentTab = (pathname: string): TabName => {
  switch (true) {
    case pathname.startsWith(Urls.dataStudioGuide()):
      return "guide";
    case pathname.startsWith(Urls.dataStudioGlossary()):
      return "glossary";
    case pathname.startsWith(Urls.dataStudioGitSync()):
      return "git-sync";
    case pathname.startsWith(Urls.workspaces()):
      return "workspaces";
    case pathname.startsWith(Urls.dependencyGraph()):
      return "dependencies";
    case pathname.startsWith(Urls.dependencyDiagnostics()):
      return "dependency-diagnostics";
    case pathname.startsWith(Urls.dataStudioSchemaViewer()):
      return "schema-viewer";
    case pathname.startsWith(Urls.dataStudioLibrary()):
      return "library";
    case pathname.startsWith(Urls.transformList()):
      return "transforms";
    case pathname.startsWith(Urls.dataStudioData()):
      return "data";
    case pathname.startsWith(Urls.dataStudioSettings()):
      return "settings";
    default:
      return "guide";
  }
};
