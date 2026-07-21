import { useFormikContext } from "formik";
import { useEffect } from "react";
import { t } from "ttag";

import { skipToken, useGetFieldQuery } from "metabase/api";
import { FormField, FormNumberInput, FormSelect } from "metabase/forms";
import { Group } from "metabase/ui";
import { TYPE } from "metabase-lib/v1/types/constants";
import { isa } from "metabase-lib/v1/types/utils/isa";
import type { LookbackUnit } from "metabase-types/api";

import type { IncrementalSettingsFormValues } from "./form";

const SUB_DAY_UNITS: ReadonlySet<LookbackUnit> = new Set([
  "millisecond",
  "second",
  "minute",
  "hour",
]);

const getUnitOptions = (dateOnly: boolean) => {
  const options: { value: LookbackUnit; label: string }[] = [
    { value: "minute", label: t`minutes` },
    { value: "hour", label: t`hours` },
    { value: "day", label: t`days` },
    { value: "week", label: t`weeks` },
    { value: "month", label: t`months` },
    { value: "year", label: t`years` },
  ];
  return dateOnly
    ? options.filter(({ value }) => !SUB_DAY_UNITS.has(value))
    : options;
};

// The lookback window input: a number plus, for temporal checkpoint columns, a unit.
export function LookbackField({ readOnly }: { readOnly?: boolean }) {
  const { values, setFieldValue } =
    useFormikContext<IncrementalSettingsFormValues>();
  const fieldId = values.checkpointFilterFieldId;
  const { data: field } = useGetFieldQuery(
    fieldId != null ? { id: Number(fieldId) } : skipToken,
  );

  const baseType = field?.base_type;
  const isTemporal = baseType != null && isa(baseType, TYPE.Temporal);
  const isDateOnly = isTemporal && !isa(baseType, TYPE.DateTime);

  // Keep the unit in step with the checkpoint column's type: temporal columns need one
  // (day-or-coarser for date-only columns), numeric ones must not have one.
  useEffect(() => {
    if (baseType == null) {
      return;
    }
    if (!isTemporal && values.lookbackUnit != null) {
      setFieldValue("lookbackUnit", null);
    } else if (
      isTemporal &&
      (values.lookbackUnit == null ||
        (isDateOnly && SUB_DAY_UNITS.has(values.lookbackUnit)))
    ) {
      setFieldValue("lookbackUnit", "day");
    }
  }, [baseType, isTemporal, isDateOnly, values.lookbackUnit, setFieldValue]);

  if (fieldId == null) {
    return null;
  }

  return (
    <FormField
      title={t`Lookback window`}
      description={t`Optional. Re-process this much already-seen data on each run, to catch late-arriving rows.`}
      maw="24rem"
    >
      <Group gap="sm" wrap="nowrap">
        <FormNumberInput
          name="lookbackValue"
          nullable
          min={1}
          placeholder={t`e.g. 4`}
          aria-label={t`Lookback amount`}
          disabled={readOnly}
          w="10rem"
        />
        {isTemporal && (
          <FormSelect
            name="lookbackUnit"
            aria-label={t`Lookback unit`}
            data={getUnitOptions(isDateOnly)}
            disabled={readOnly}
            w="9rem"
          />
        )}
      </Group>
    </FormField>
  );
}
