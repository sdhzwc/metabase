import _ from "underscore";

import * as Lib from "metabase-lib";
import Question from "metabase-lib/v1/Question";
import type Metadata from "metabase-lib/v1/metadata/Metadata";
import type { ParameterWithTarget } from "metabase-lib/v1/parameters/types";
import { InternalQuery } from "metabase-lib/v1/queries/InternalQuery";
import type {
  Card,
  Parameter,
  ParameterTarget,
  TemplateTag,
} from "metabase-types/api";

function getParameterType(tag: TemplateTag) {
  if (tag["widget-type"]) {
    return tag["widget-type"];
  }

  const { type } = tag;

  if (type === "date") {
    return "date/single";
  }
  if (type === "text") {
    return "string/=";
  }
  if (type === "number") {
    return "number/=";
  }
  if (type === "boolean") {
    return "boolean/=";
  }
  if (type === "temporal-unit") {
    return "temporal-unit";
  }

  return "string/=";
}

function getParameterTarget(tag: TemplateTag): ParameterTarget {
  return tag.type === "dimension" || tag.type === "temporal-unit"
    ? ["dimension", ["template-tag", tag.name]]
    : ["variable", ["template-tag", tag.name]];
}

const CURRENT_USER_TEMPLATE_TAG_NAMES = new Set([
  "current_user_id",
  "current_user_email",
  "current_user_first_name",
  "current_user_last_name",
  "current_user_common_name",
  "current_user_is_superuser",
]);

export function isCurrentUserTemplateTagName(name: string | undefined) {
  return name != null && CURRENT_USER_TEMPLATE_TAG_NAMES.has(name);
}

function targetTemplateTagName(target: ParameterTarget | undefined) {
  const targetReference = target?.[1];
  return Array.isArray(targetReference) &&
    targetReference[0] === "template-tag" &&
    typeof targetReference[1] === "string"
    ? targetReference[1]
    : undefined;
}

export function isCurrentUserParameter(
  parameter: Pick<Parameter, "slug" | "target">,
) {
  return (
    isCurrentUserTemplateTagName(parameter.slug) ||
    isCurrentUserTemplateTagName(targetTemplateTagName(parameter.target))
  );
}

export function getTemplateTagParameter(
  tag: TemplateTag,
  oldParameter?: Partial<Parameter>,
): ParameterWithTarget {
  return {
    id: tag.id,
    type: getParameterType(tag),
    target: getParameterTarget(tag),
    name: tag["display-name"],
    slug: tag.name,
    default: tag.default,
    required: tag.required,
    options: tag.options,
    isMultiSelect: oldParameter?.isMultiSelect ?? tag.type === "dimension",
    values_query_type: oldParameter?.values_query_type,
    values_source_type: oldParameter?.values_source_type,
    values_source_config: oldParameter?.values_source_config,
    temporal_units: oldParameter?.temporal_units,
  };
}

// NOTE: this should mirror `template-tag-parameters` in src/metabase/queries/models/card.clj
// If this function moves you should update the comment that links to this one
export function getTemplateTagParameters(
  tags: TemplateTag[],
  parameters: Parameter[] = [],
): ParameterWithTarget[] {
  const parametersById = _.indexBy(parameters, "id");

  return tags
    .filter(
      (tag) =>
        tag.type != null &&
        tag.type !== "card" &&
        tag.type !== "table" &&
        tag.type !== "snippet" &&
        !isCurrentUserTemplateTagName(tag.name) &&
        ((tag.type !== "dimension" && tag.type !== "temporal-unit") ||
          tag.dimension != null ||
          (tag["widget-type"] && tag["widget-type"] !== "none")),
    )
    .map((tag) => getTemplateTagParameter(tag, parametersById[tag.id]));
}

export function getTemplateTags(card: Card, metadata: Metadata): TemplateTag[] {
  const question = new Question(card, metadata);
  // this code path is used by the last audit v1 query, `bad_table`
  if (InternalQuery.isDatasetQueryType(question.datasetQuery())) {
    return [];
  }
  const query = question.query();
  const { isNative } = Lib.queryDisplayInfo(query);
  return isNative ? Object.values(Lib.templateTags(question.query())) : [];
}

export function getParametersFromCard(
  card: Card,
  metadata: Metadata,
): Parameter[] | ParameterWithTarget[] {
  if (!card) {
    return [];
  }

  if (card.parameters && !_.isEmpty(card.parameters)) {
    return card.parameters;
  }

  return getTemplateTagParametersFromCard(card, metadata);
}

export function getTemplateTagParametersFromCard(
  card: Card,
  metadata: Metadata,
) {
  const tags = getTemplateTags(card, metadata);
  return getTemplateTagParameters(tags, card.parameters);
}
