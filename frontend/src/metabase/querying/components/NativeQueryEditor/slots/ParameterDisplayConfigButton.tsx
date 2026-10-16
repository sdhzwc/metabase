import { useEffect, useMemo, useState } from "react";
import { t } from "ttag";

import { useIsSmallScreen } from "metabase/common/hooks/use-is-small-screen";
import { useLocale } from "metabase/common/hooks/use-locale";
import {
  getDefaultVisibleParameterSlugs,
  readVisibleGroupSlugs,
  readVisibleParameterSlugs,
  saveVisibleGroupSlugs,
  saveVisibleParameterSlugs,
  updateQueryGroupFields,
} from "metabase/querying/components/parameter-display-config";
import {
  Box,
  Button,
  Checkbox,
  Flex,
  Icon,
  Popover,
  Text,
  TextInput,
  Tooltip,
} from "metabase/ui";
import { isSimplifiedChineseLocale } from "metabase/utils/i18n";

import VisibilityTogglerS from "../VisibilityToggler/VisibilityToggler.module.css";
import { useNativeQueryEditorContext } from "../context/NativeQueryEditorContext";

import S from "./ParameterDisplayConfigButton.module.css";

type ConfigTab = "parameters" | "display";

export function ParameterDisplayConfigButton() {
  const {
    question,
    query,
    setDatasetQuery,
    runQuery,
    setParameterValue,
    isNativeEditorOpen,
  } = useNativeQueryEditorContext();
  const isSmallScreen = useIsSmallScreen();
  const { locale } = useLocale();
  const isChinese = isSimplifiedChineseLocale(locale);
  const parameters = question.parameters();
  const cardId = question.id() ?? undefined;
  const parameterSlugKey = parameters.map(({ slug }) => slug).join("\u0000");
  const parameterSlugs = useMemo(
    () => (parameterSlugKey ? parameterSlugKey.split("\u0000") : []),
    [parameterSlugKey],
  );

  const [opened, setOpened] = useState(false);
  const [activeTab, setActiveTab] = useState<ConfigTab>("parameters");
  const [search, setSearch] = useState("");
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(() =>
    getDefaultVisibleParameterSlugs(parameterSlugs),
  );
  const [selectedGroupSlugs, setSelectedGroupSlugs] = useState<string[]>([]);
  const [draftSlugs, setDraftSlugs] = useState<string[]>([]);
  const [draftGroupSlugs, setDraftGroupSlugs] = useState<string[]>([]);

  useEffect(() => {
    const stored = readVisibleParameterSlugs(cardId);
    setSelectedSlugs(
      stored?.filter((slug) => parameterSlugs.includes(slug)) ??
        getDefaultVisibleParameterSlugs(parameterSlugs),
    );
  }, [cardId, parameterSlugs]);

  useEffect(() => {
    const storedGroupSlugs = readVisibleGroupSlugs(cardId);
    const nextGroupSlugs =
      storedGroupSlugs?.filter((slug) => parameterSlugs.includes(slug)) ?? [];
    setSelectedGroupSlugs(nextGroupSlugs);
  }, [cardId, parameterSlugs]);

  const draftSelection =
    activeTab === "parameters" ? draftSlugs : draftGroupSlugs;
  const setDraftSelection =
    activeTab === "parameters" ? setDraftSlugs : setDraftGroupSlugs;
  const options = parameters.map((parameter) => ({
    key: parameter.slug,
    label: parameter.name || parameter.slug,
  }));
  const optionKeys = parameterSlugs;

  const filteredOptions = options.filter((option) => {
    const query = search.trim().toLocaleLowerCase();
    return (
      !query ||
      `${option.label} ${option.key}`.toLocaleLowerCase().includes(query)
    );
  });

  if (isSmallScreen || !setParameterValue || parameters.length === 0) {
    return null;
  }

  const toggleConfig = () => {
    if (opened) {
      setOpened(false);
      return;
    }

    setActiveTab("parameters");
    setSearch("");
    setDraftSlugs(selectedSlugs);
    setDraftGroupSlugs(selectedGroupSlugs);
    setOpened(true);
  };

  const toggleSelection = (key: string) => {
    setDraftSelection((current) =>
      current.includes(key)
        ? current.filter((currentKey) => currentKey !== key)
        : [...current, key],
    );
  };

  const save = () => {
    setSelectedSlugs(draftSlugs);
    saveVisibleParameterSlugs(cardId, draftSlugs);
    setSelectedGroupSlugs(draftGroupSlugs);
    saveVisibleGroupSlugs(cardId, draftGroupSlugs);
    const updatedQueryText = updateQueryGroupFields(
      query.queryText(),
      selectedGroupSlugs,
      draftGroupSlugs,
      Object.fromEntries(
        parameters.map((parameter) => [
          parameter.slug,
          parameter.name || parameter.slug,
        ]),
      ),
    );
    if (updatedQueryText !== query.queryText()) {
      setDatasetQuery(query.setQueryText(updatedQueryText));
      runQuery?.();
    }
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      offset={10}
      withArrow
    >
      <Popover.Target>
        <Tooltip
          label={isChinese ? "配置展示项" : t`Configure visible parameters`}
          disabled={!isNativeEditorOpen}
          position="top"
        >
          <Flex
            component="button"
            type="button"
            align="center"
            className={`${VisibilityTogglerS.ToggleContent} ${S.trigger} ${
              isNativeEditorOpen ? S.iconTrigger : ""
            }`}
            onClick={toggleConfig}
            aria-expanded={opened}
            aria-label={
              isChinese ? "配置展示项" : t`Configure visible parameters`
            }
          >
            {!isNativeEditorOpen && (
              <Text component="span" mr="sm" miw={70}>
                {isChinese ? "配置展示项" : t`Configure visible parameters`}
              </Text>
            )}
            <Icon name="gear" size={18} aria-hidden />
          </Flex>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className={S.dropdown} p={0}>
        <Box className={S.content}>
          <Box className={S.header}>
            <Text fw="bold" size="md" c="text-primary">
              {isChinese ? "配置展示项" : t`Configure visible parameters`}
            </Text>
            <Flex align="center" gap="xs" mt="xs">
              <Icon name="info" size={14} c="text-secondary" />
              <Text size="sm" c="text-secondary">
                {isChinese
                  ? `共 ${options.length} 个${activeTab === "parameters" ? "参数" : "分组"}，已选 ${draftSelection.length} 个`
                  : `${options.length} ${activeTab === "parameters" ? "parameters" : "groups"}, ${draftSelection.length} selected`}
              </Text>
            </Flex>
            <Flex className={S.tabs} role="tablist" mt="md">
              <button
                type="button"
                role="tab"
                className={S.tab}
                aria-selected={activeTab === "parameters"}
                onClick={() => {
                  setActiveTab("parameters");
                  setSearch("");
                }}
              >
                {isChinese ? "参数配置" : t`Parameter configuration`}
              </button>
              <button
                type="button"
                role="tab"
                className={S.tab}
                aria-selected={activeTab === "display"}
                onClick={() => {
                  setActiveTab("display");
                  setSearch("");
                }}
              >
                {isChinese ? "分组配置" : t`Group configuration`}
              </button>
            </Flex>
            <TextInput
              value={search}
              placeholder={
                isChinese
                  ? activeTab === "parameters"
                    ? "搜索参数"
                    : "搜索分组"
                  : activeTab === "parameters"
                    ? "Search parameters"
                    : "Search groups"
              }
              aria-label={
                isChinese
                  ? activeTab === "parameters"
                    ? "搜索参数"
                    : "搜索分组"
                  : activeTab === "parameters"
                    ? "Search parameters"
                    : "Search groups"
              }
              leftSection={<Icon name="search" size={16} />}
              onChange={(event) => setSearch(event.target.value)}
              mt="md"
            />
            <Flex gap="sm" mt="xs">
              <Button
                className={S.bulkButton}
                variant="outline"
                size="xs"
                onClick={() => setDraftSelection(optionKeys)}
              >
                {isChinese ? "全选" : t`Select all`}
              </Button>
              <Button
                className={S.bulkButton}
                variant="outline"
                size="xs"
                onClick={() =>
                  setDraftSelection(
                    activeTab === "parameters"
                      ? getDefaultVisibleParameterSlugs(parameterSlugs)
                      : [],
                  )
                }
              >
                {isChinese ? "重置" : t`Reset`}
              </Button>
            </Flex>
          </Box>
          <Box className={S.options}>
            {filteredOptions.map((option) => (
              <Checkbox
                key={option.key}
                className={S.option}
                label={option.label}
                checked={draftSelection.includes(option.key)}
                onChange={() => toggleSelection(option.key)}
              />
            ))}
          </Box>
          <Box className={S.footer}>
            <Flex gap="sm">
              <Button className={S.bulkButton} onClick={save}>
                {isChinese ? "保存" : t`Save`}
              </Button>
              <Button
                className={S.bulkButton}
                variant="outline"
                onClick={() => setOpened(false)}
              >
                {isChinese ? "取消" : t`Cancel`}
              </Button>
            </Flex>
          </Box>
        </Box>
      </Popover.Dropdown>
    </Popover>
  );
}
