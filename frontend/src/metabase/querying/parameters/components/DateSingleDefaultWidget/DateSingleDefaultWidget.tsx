import { type FormEvent, useMemo, useState } from "react";

import { useLocale } from "metabase/common/hooks";
import {
  getDynamicDateTemplateDate,
  getSingleDateDefaultLabels,
  serializeDynamicDateTemplate,
} from "metabase/querying/common/utils/dates";
import {
  deserializeDateParameterValue,
  serializeDateParameterValue,
} from "metabase/querying/parameters/utils/parsing";
import { Box, Button, Stack, TextInput } from "metabase/ui";
import type { ParameterValueOrArray } from "metabase-types/api";

import { DateSingleWidget } from "../DateSingleWidget";

type DateSingleDefaultWidgetProps = {
  value: ParameterValueOrArray | null | undefined;
  submitButtonLabel?: string;
  onChange: (value: string) => void;
};

type PickerMode = "shortcuts" | "dynamic" | "fixed";

const DEFAULT_DYNAMIC_DATE_TEMPLATE = "%Y%m%d";

export function DateSingleDefaultWidget({
  value,
  submitButtonLabel,
  onChange,
}: DateSingleDefaultWidgetProps) {
  const { locale } = useLocale();
  const labels = getSingleDateDefaultLabels(locale);
  const dateValue = useMemo(
    () => deserializeDateParameterValue(value),
    [value],
  );
  const [mode, setMode] = useState<PickerMode>(() => getInitialMode(value));
  const [template, setTemplate] = useState(() =>
    dateValue?.type === "dynamic-template"
      ? dateValue.template
      : DEFAULT_DYNAMIC_DATE_TEMPLATE,
  );
  const [error, setError] = useState<string | null>(null);

  const handleDynamicSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (getDynamicDateTemplateDate(template) == null) {
      setError(labels.invalidDynamicDateTemplate);
      return;
    }

    onChange(serializeDynamicDateTemplate(template));
  };

  if (mode === "fixed") {
    return (
      <DateSingleWidget
        value={value}
        submitButtonLabel={submitButtonLabel}
        onChange={onChange}
      />
    );
  }

  if (mode === "dynamic") {
    return (
      <Box component="form" p="sm" miw={300} onSubmit={handleDynamicSubmit}>
        <Stack gap="sm">
          <TextInput
            autoFocus
            label={labels.dynamicDateTemplate}
            value={template}
            error={error}
            onChange={(event) => {
              setTemplate(event.currentTarget.value);
              setError(null);
            }}
          />
          <Button type="submit" variant="filled">
            {labels.apply}
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box p="sm" miw={300}>
      <Stack gap="xs">
        <ShortcutButton
          label={labels.today}
          value={serializeDateParameterValue({
            type: "relative",
            value: 0,
            unit: "day",
          })}
          onChange={onChange}
        />
        <ShortcutButton
          label={labels.yesterday}
          value={serializeDateParameterValue({
            type: "relative",
            value: -1,
            unit: "day",
          })}
          onChange={onChange}
        />
        <ShortcutButton
          label={labels.dayBeforeYesterday}
          value={serializeDateParameterValue({
            type: "relative",
            value: -1,
            unit: "day",
            offsetValue: -1,
            offsetUnit: "day",
          })}
          onChange={onChange}
        />
        <Button variant="subtle" fw="normal" onClick={() => setMode("dynamic")}>
          {labels.customDynamicDate}
        </Button>
        <Button variant="subtle" fw="normal" onClick={() => setMode("fixed")}>
          {labels.customFixedDate}
        </Button>
      </Stack>
    </Box>
  );
}

type ShortcutButtonProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

function ShortcutButton({ label, value, onChange }: ShortcutButtonProps) {
  return (
    <Button variant="subtle" fw="normal" onClick={() => onChange(value)}>
      {label}
    </Button>
  );
}

function getInitialMode(value: ParameterValueOrArray | null | undefined) {
  const dateValue = deserializeDateParameterValue(value);

  if (dateValue?.type === "specific") {
    return "fixed";
  }

  if (dateValue?.type === "dynamic-template") {
    return "dynamic";
  }

  return "shortcuts";
}
