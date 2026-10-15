import { useEffect, useMemo, useState } from "react";
import { t } from "ttag";

import { useIsSmallScreen } from "metabase/common/hooks/use-is-small-screen";
import { useLocale } from "metabase/common/hooks/use-locale";
import {
  getDefaultVisibleParameterSlugs,
  readVisibleParameterSlugs,
  saveVisibleParameterSlugs,
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
} from "metabase/ui";
import { isSimplifiedChineseLocale } from "metabase/utils/i18n";

import VisibilityTogglerS from "../VisibilityToggler/VisibilityToggler.module.css";
import { useNativeQueryEditorContext } from "../context/NativeQueryEditorContext";

import S from "./ParameterDisplayConfigButton.module.css";

export function ParameterDisplayConfigButton() {
  const { question, setParameterValue, isNativeEditorOpen } =
    useNativeQueryEditorContext();
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
  const [search, setSearch] = useState("");
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(() =>
    getDefaultVisibleParameterSlugs(parameterSlugs),
  );
  const [draftSlugs, setDraftSlugs] = useState<string[]>([]);

  useEffect(() => {
    const stored = readVisibleParameterSlugs(cardId);
    setSelectedSlugs(
      stored?.filter((slug) => parameterSlugs.includes(slug)) ??
        getDefaultVisibleParameterSlugs(parameterSlugs),
    );
  }, [cardId, parameterSlugs]);

  const filteredParameters = parameters.filter((parameter) => {
    const query = search.trim().toLocaleLowerCase();
    return (
      !query ||
      `${parameter.name} ${parameter.slug}`.toLocaleLowerCase().includes(query)
    );
  });

  if (
    isSmallScreen ||
    isNativeEditorOpen ||
    !setParameterValue ||
    parameters.length === 0
  ) {
    return null;
  }

  const openConfig = () => {
    setSearch("");
    setDraftSlugs(selectedSlugs);
    setOpened(true);
  };

  const toggleSlug = (slug: string) => {
    setDraftSlugs((current) =>
      current.includes(slug)
        ? current.filter((currentSlug) => currentSlug !== slug)
        : [...current, slug],
    );
  };

  const save = () => {
    setSelectedSlugs(draftSlugs);
    saveVisibleParameterSlugs(cardId, draftSlugs);
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
        <Flex
          component="button"
          type="button"
          align="center"
          className={`${VisibilityTogglerS.ToggleContent} ${S.trigger}`}
          onClick={openConfig}
        >
          <Text component="span" mr="sm" miw={70}>
            {isChinese ? "配置展示项" : t`Configure visible parameters`}
          </Text>
          <Icon name="gear" size={18} aria-hidden />
        </Flex>
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
                  ? `共 ${parameters.length} 个参数，已选 ${draftSlugs.length} 个`
                  : `${parameters.length} parameters, ${draftSlugs.length} selected`}
              </Text>
            </Flex>
            <TextInput
              value={search}
              placeholder={isChinese ? "搜索参数" : "Search parameters"}
              aria-label={isChinese ? "搜索参数" : "Search parameters"}
              leftSection={<Icon name="search" size={16} />}
              onChange={(event) => setSearch(event.target.value)}
              mt="md"
            />
            <Flex gap="sm" mt="xs">
              <Button
                className={S.bulkButton}
                variant="outline"
                size="xs"
                onClick={() => setDraftSlugs(parameterSlugs)}
              >
                {isChinese ? "全选" : t`Select all`}
              </Button>
              <Button
                className={S.bulkButton}
                variant="outline"
                size="xs"
                onClick={() =>
                  setDraftSlugs(getDefaultVisibleParameterSlugs(parameterSlugs))
                }
              >
                {isChinese ? "重置" : t`Reset`}
              </Button>
            </Flex>
          </Box>
          <Box className={S.options}>
            {filteredParameters.map((parameter) => (
              <Checkbox
                key={parameter.slug}
                className={S.option}
                label={parameter.name || parameter.slug}
                checked={draftSlugs.includes(parameter.slug)}
                onChange={() => toggleSlug(parameter.slug)}
              />
            ))}
          </Box>
          <Box className={S.footer}>
            <Flex gap="sm">
              <Button fullWidth onClick={save}>
                {isChinese ? "保存" : t`Save`}
              </Button>
              <Button fullWidth onClick={() => setOpened(false)}>
                {isChinese ? "取消" : t`Cancel`}
              </Button>
            </Flex>
          </Box>
        </Box>
      </Popover.Dropdown>
    </Popover>
  );
}
