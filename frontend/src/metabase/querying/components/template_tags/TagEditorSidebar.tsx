import { useState } from "react";
import { t } from "ttag";
import _ from "underscore";

import { SidebarContent } from "metabase/common/components/SidebarContent";
import { useLocale } from "metabase/common/hooks";
import { Badge, Box, Flex, Tabs, Text } from "metabase/ui";
import { isSimplifiedChineseLocale } from "metabase/utils/i18n";
import type Question from "metabase-lib/v1/Question";
import type Database from "metabase-lib/v1/metadata/Database";
import { isCurrentUserTemplateTagName } from "metabase-lib/v1/parameters/utils/template-tags";
import type NativeQuery from "metabase-lib/v1/queries/NativeQuery";
import type {
  DatabaseId,
  EmbeddingParameterVisibility,
  NativeDatasetQuery,
  Parameter,
  ParameterId,
  ParameterValuesConfig,
  RowValue,
  TemplateTag,
  TemplateTagId,
} from "metabase-types/api";

import { TagEditorHelp } from "./TagEditorHelp";
import { TagEditorParam } from "./TagEditorParam";
import TagEditorParamS from "./TagEditorParam.module.css";

type TabId = "settings" | "help";

type GetEmbeddedParamVisibility = (
  slug: string,
) => EmbeddingParameterVisibility;

interface TagEditorSidebarProps {
  query: NativeQuery;
  databases?: Database[];
  question: Question;
  originalQuestion?: Question;
  sampleDatabaseId?: DatabaseId;
  setDatasetQuery: (query: NativeDatasetQuery) => void;
  setTemplateTag: (tag: TemplateTag) => void;
  setTemplateTagConfig: (
    tag: TemplateTag,
    config: ParameterValuesConfig,
  ) => void;
  setParameterValue: (tagId: TemplateTagId, value: RowValue) => void;
  onClose: () => void;
  getEmbeddedParameterVisibility: GetEmbeddedParamVisibility;
  parametersAreUserVisible?: boolean;
}

export function TagEditorSidebar({
  query,
  databases,
  question,
  originalQuestion,
  sampleDatabaseId,
  setDatasetQuery,
  setTemplateTag,
  setTemplateTagConfig,
  setParameterValue,
  onClose,
  getEmbeddedParameterVisibility,
  parametersAreUserVisible = true,
}: TagEditorSidebarProps) {
  const [section, setSection] = useState<TabId>(() => {
    const tags = query.variableTemplateTags();
    return tags.length === 0 ? "help" : "settings";
  });

  const tags = query.variableTemplateTags();
  const database = question.database();
  const parameters = question.parameters();
  const parametersById = _.indexBy(parameters, "id");

  const effectiveSection = tags.length === 0 ? "help" : section;

  const handleTabChange = (tab: string | null) => {
    if (tab) {
      // Unjustified type cast. FIXME
      setSection(tab as TabId);
    }
  };

  return (
    <SidebarContent title={t`Variables and parameters`} onClose={onClose}>
      <div data-testid="tag-editor-sidebar">
        <Tabs radius={0} value={effectiveSection} onChange={handleTabChange}>
          <Tabs.List grow>
            <Tabs.Tab value="settings">{t`Settings`}</Tabs.Tab>
            <Tabs.Tab value="help">{t`Help`}</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {effectiveSection === "settings" ? (
          <SettingsPane
            tags={tags}
            parametersById={parametersById}
            database={database}
            // Unjustified type cast. FIXME
            databases={databases as Database[]}
            originalQuestion={originalQuestion}
            setTemplateTag={setTemplateTag}
            setTemplateTagConfig={setTemplateTagConfig}
            setParameterValue={setParameterValue}
            getEmbeddedParameterVisibility={getEmbeddedParameterVisibility}
            parametersAreUserVisible={parametersAreUserVisible}
          />
        ) : (
          <Box p="lg">
            <TagEditorHelp
              database={database}
              sampleDatabaseId={sampleDatabaseId}
              setDatasetQuery={setDatasetQuery}
              switchToSettings={() => setSection("settings")}
            />
          </Box>
        )}
      </div>
    </SidebarContent>
  );
}

interface SettingsPaneProps {
  tags: TemplateTag[];
  database?: Database | null;
  databases: Database[];
  parametersById: Record<ParameterId, Parameter>;
  originalQuestion?: Question;
  setTemplateTag: (tag: TemplateTag) => void;
  setTemplateTagConfig: (
    tag: TemplateTag,
    config: ParameterValuesConfig,
  ) => void;
  setParameterValue: (tagId: TemplateTagId, value: RowValue) => void;
  getEmbeddedParameterVisibility: GetEmbeddedParamVisibility;
  parametersAreUserVisible?: boolean;
}

const SettingsPane = ({
  tags,
  parametersById,
  database,
  databases,
  originalQuestion,
  setTemplateTag,
  setTemplateTagConfig,
  setParameterValue,
  getEmbeddedParameterVisibility,
  parametersAreUserVisible = true,
}: SettingsPaneProps) => {
  return tags.map((tag) => (
    <div key={tag.id}>
      {isCurrentUserTemplateTagName(tag.name) ? (
        <SystemTemplateTagInfo tag={tag} />
      ) : (
        <TagEditorParam
          tag={tag}
          key={tag.name}
          parameter={parametersById[tag.id]}
          embeddedParameterVisibility={
            parametersById[tag.id]
              ? getEmbeddedParameterVisibility(parametersById[tag.id].slug)
              : null
          }
          database={database}
          databases={databases}
          originalQuestion={originalQuestion}
          setTemplateTag={setTemplateTag}
          setTemplateTagConfig={setTemplateTagConfig}
          setParameterValue={setParameterValue}
          parametersAreUserVisible={parametersAreUserVisible}
        />
      )}
    </div>
  ));
};

const SystemTemplateTagInfo = ({ tag }: { tag: TemplateTag }) => {
  const { locale } = useLocale();
  const copy = getSystemTemplateTagInfoCopy(locale);

  return (
    <Box
      className={TagEditorParamS.TagContainer}
      data-testid={`tag-editor-system-variable-${tag.name}`}
    >
      <Flex align="center" gap="sm" mb="sm">
        <Text c="brand" fw={900} size="lg">
          {tag.name}
        </Text>
        <Badge color="brand" size="sm" variant="light">
          {copy.badge}
        </Badge>
      </Flex>
      <Text c="text-secondary" size="sm">
        {copy.description}
      </Text>
    </Box>
  );
};

function getSystemTemplateTagInfoCopy(locale?: string) {
  if (isSimplifiedChineseLocale(locale)) {
    return {
      badge: "系统变量",
      description: "由当前登录用户信息自动填充，无法手动设置或覆盖。",
    };
  }

  return {
    badge: t`System built-in variable`,
    description: t`This variable is automatically filled from the current signed-in user and cannot be manually set or overridden.`,
  };
}
