import { render, screen } from "__support__/ui";
import type { NativeQueryEditorContextValue } from "metabase/querying/components/NativeQueryEditor/context/NativeQueryEditorContext";
import { NativeQueryEditorContextProvider } from "metabase/querying/components/NativeQueryEditor/context/NativeQueryEditorContext";

import { VisibilityToggler } from "./VisibilityToggler";

const mockContext = (
  opts?: Partial<NativeQueryEditorContextValue>,
): NativeQueryEditorContextValue => ({
  // Unjustified type cast. FIXME
  question: { isArchived: () => false } as any,
  // Unjustified type cast. FIXME
  query: { hasWritePermission: () => true } as any,
  setDatasetQuery: jest.fn(),
  focusEditor: jest.fn(),
  onFormatQuery: jest.fn(),
  isNativeEditorOpen: false,
  setIsNativeEditorOpen: jest.fn(),
  toggleEditor: jest.fn(),
  canChangeDatabase: true,
  editorContext: "question",
  isRunnable: true,
  isRunning: false,
  isResultDirty: false,
  snippets: [],
  snippetCollections: [],
  isShowingDataReference: false,
  isShowingSnippetSidebar: false,
  isShowingTemplateTagsEditor: false,
  ...opts,
});

const setup = (opts?: Partial<NativeQueryEditorContextValue>) => {
  render(
    <NativeQueryEditorContextProvider value={mockContext(opts)}>
      <VisibilityToggler />
    </NativeQueryEditorContextProvider>,
  );
};

describe("NativeQueryEditor VisibilityToggler slot", () => {
  it("renders the editor toggle by default", () => {
    setup();

    expect(screen.getByTestId("visibility-toggler")).toBeInTheDocument();
  });

  it("does not render the editor toggle when the editor is disabled", () => {
    setup({ isNativeEditorDisabled: true });

    expect(screen.queryByTestId("visibility-toggler")).not.toBeInTheDocument();
  });
});
