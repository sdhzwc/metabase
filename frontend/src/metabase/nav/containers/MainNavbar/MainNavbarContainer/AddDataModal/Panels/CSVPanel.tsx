import { match } from "ts-pattern";
import { t } from "ttag";

import {
  StoragePurchaseButton,
  StorageSetupErrorView,
  StorageSetupView,
} from "metabase/common/components/upsells/StoragePurchaseModal";
import { Center, Loader } from "metabase/ui";
import * as Urls from "metabase/urls";

import { useCsvPanelState } from "../csv-panel-state";

import {
  CSVPanelEmptyState,
  CSVStorageAwaitingRestartEmptyState,
} from "./AddDataModalEmptyStates";
import { CSVUpload } from "./CSVUpload";

interface CSVPanelProps {
  onCloseAddDataModal: () => void;
}

export const CSVPanel = ({ onCloseAddDataModal }: CSVPanelProps) => {
  const state = useCsvPanelState();

  return match(state)
    .with({ type: "loading" }, () => (
      <Center h="100%">
        <Loader data-testid="loading-indicator" />
      </Center>
    ))
    .with({ type: "provisioning-storage" }, () => <StorageSetupView />)
    .with({ type: "storage-setup-failed" }, () => <StorageSetupErrorView />)
    .with({ type: "storage-awaiting-restart" }, () => (
      <CSVStorageAwaitingRestartEmptyState />
    ))
    .with({ type: "ask-admin" }, () => (
      <CSVPanelEmptyState contactAdminReason="enable-csv-upload" />
    ))
    .with({ type: "no-upload-permission" }, () => (
      <CSVPanelEmptyState contactAdminReason="obtain-csv-upload-permission" />
    ))
    .with({ type: "needs-uploads-setup" }, ({ canOfferStorage }) => (
      <CSVPanelEmptyState
        ctaLink={{
          text: t`Enable uploads`,
          to: Urls.uploadsSettings(),
        }}
        secondaryAction={
          canOfferStorage ? (
            <StoragePurchaseButton location="add-data-modal-csv" />
          ) : undefined
        }
      />
    ))
    .with({ type: "ready" }, () => (
      <CSVUpload onCloseAddDataModal={onCloseAddDataModal} />
    ))
    .exhaustive();
};
