import { t } from "ttag";

import type { MetabotProvider, SettingDefinition } from "metabase-types/api";

type ApiKeylessProviders = "metabase";
type ApiKeyProviders = Exclude<MetabotProvider, ApiKeylessProviders>;

type MetabotApiKeylessProviderOption = {
  value: ApiKeylessProviders;
  label: string;
};

type MetabotApiKeyProviderOption = {
  value: ApiKeyProviders;
  label: string;
  apiKey: {
    placeholder: string;
    addKeyUrl: string;
  };
};

export type MetabotProviderOption =
  | MetabotApiKeylessProviderOption
  | MetabotApiKeyProviderOption;

export function getProviderOptions(
  hasMetabaseProviderAccess: boolean,
): Partial<Record<ApiKeylessProviders, MetabotApiKeylessProviderOption>> &
  Record<ApiKeyProviders, MetabotApiKeyProviderOption> {
  return {
    ...(hasMetabaseProviderAccess && {
      metabase: {
        value: "metabase" as const,
        // eslint-disable-next-line metabase/no-literal-metabase-strings -- "Metabase" is the product name for the managed AI provider option, only shown to admins configuring AI.
        label: "Metabase",
      },
    }),
    anthropic: {
      value: "anthropic",
      label: "Anthropic",
      apiKey: {
        placeholder: "sk-ant-api03-...",
        addKeyUrl: "https://console.anthropic.com/settings/keys",
      },
    },
    azure: {
      value: "azure",
      label: "Microsoft Azure",
      apiKey: {
        // Azure data-plane keys have no recognizable prefix
        placeholder: t`Enter your Azure API key`,
        addKeyUrl: "https://ai.azure.com",
      },
    },
    bedrock: {
      value: "bedrock",
      label: "Amazon Bedrock",
      apiKey: {
        placeholder: "AKIA...",
        addKeyUrl:
          "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
      },
    },
    bailian: {
      value: "bailian",
      label: "Qwen",
      apiKey: {
        placeholder: t`Enter your Alibaba Cloud Bailian API key`,
        addKeyUrl: "https://bailian.console.aliyun.com",
      },
    },
    deepseek: {
      value: "deepseek",
      label: "DeepSeek",
      apiKey: {
        placeholder: t`Enter your DeepSeek API key`,
        addKeyUrl: "https://platform.deepseek.com/api_keys",
      },
    },
    kimi: {
      value: "kimi",
      label: "Kimi",
      apiKey: {
        placeholder: t`Enter your Kimi API key`,
        addKeyUrl: "https://platform.kimi.com/console/api-keys",
      },
    },
    openai: {
      value: "openai",
      label: "OpenAI",
      apiKey: {
        placeholder: "sk-proj-...",
        addKeyUrl: "https://platform.openai.com/api-keys",
      },
    },
    openrouter: {
      value: "openrouter",
      label: "OpenRouter",
      apiKey: {
        placeholder: "sk-or-v1-...",
        addKeyUrl: "https://openrouter.ai/keys",
      },
    },
    xiaomi: {
      value: "xiaomi",
      label: "Xiaomi MiMo",
      apiKey: {
        placeholder: "sk-... / tp-...",
        addKeyUrl: "https://mimo.mi.com",
      },
    },
  };
}

export type MetabotApiKeyProvider = Exclude<
  MetabotProvider,
  "metabase" | "azure" | "bedrock"
>;

export function isMetabotProvider(
  value: string | null | undefined,
): value is MetabotProvider {
  return (
    value === "anthropic" ||
    value === "azure" ||
    value === "bailian" ||
    value === "bedrock" ||
    value === "deepseek" ||
    value === "kimi" ||
    value === "metabase" ||
    value === "openai" ||
    value === "openrouter" ||
    value === "xiaomi"
  );
}

export function isAvailableProvider(provider: MetabotProvider): boolean {
  return (
    provider === "anthropic" ||
    provider === "azure" ||
    provider === "bailian" ||
    provider === "bedrock" ||
    provider === "deepseek" ||
    provider === "kimi" ||
    provider === "metabase" ||
    provider === "openai" ||
    provider === "openrouter" ||
    provider === "xiaomi"
  );
}

export const API_KEY_SETTING_BY_PROVIDER: Record<
  MetabotApiKeyProvider,
  | "llm-anthropic-api-key"
  | "llm-bailian-api-key"
  | "llm-deepseek-api-key"
  | "llm-kimi-api-key"
  | "llm-openai-api-key"
  | "llm-openrouter-api-key"
  | "llm-xiaomi-api-key"
> = {
  anthropic: "llm-anthropic-api-key",
  bailian: "llm-bailian-api-key",
  deepseek: "llm-deepseek-api-key",
  kimi: "llm-kimi-api-key",
  openai: "llm-openai-api-key",
  openrouter: "llm-openrouter-api-key",
  xiaomi: "llm-xiaomi-api-key",
};

export const AZURE_MODEL_FAMILIES = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
] as const;

export function parseAzureModel(model: string | undefined) {
  const [family, deployment] = model?.split(/\/(.+)/, 2) ?? [];
  return { family, deployment };
}

export function parseProviderAndModel(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const [provider, model] = value.split(/\/(.+)/, 2);
  if (!isMetabotProvider(provider) || !model) {
    return undefined;
  }

  return { provider, model };
}

export const hasConfiguredSettingValue = (
  setting: SettingDefinition | undefined,
) => Boolean(setting?.value || setting?.is_env_setting);
