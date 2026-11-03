import { useCallback, useEffect, useState } from "react";
import { t } from "ttag";

import type { MfaChallengeResponse } from "metabase/api/session";
import { sessionApi } from "metabase/api/session";
import { PLUGIN_MULTI_FACTOR_AUTH } from "metabase/plugins";
import { useDispatch, useSelector } from "metabase/redux";
import type { LoginData } from "metabase/redux/auth";
import { completeLogin, login } from "metabase/redux/auth";
import { Box } from "metabase/ui";

import {
  getExternalAuthProviders,
  getHasSessionCookies,
  getIsLdapEnabled,
} from "../../selectors";
import { AuthTextLink } from "../AuthButton";
import { LoginForm } from "../LoginForm";

import { ActionList, ActionListItem } from "./PasswordPanel.styled";

interface PasswordPanelProps {
  redirectUrl?: string;
  userid?: string;
}

export const PasswordPanel = ({ redirectUrl, userid }: PasswordPanelProps) => {
  const providers = useSelector(getExternalAuthProviders);
  const isLdapEnabled = useSelector(getIsLdapEnabled);
  const hasSessionCookies = useSelector(getHasSessionCookies);
  const dispatch = useDispatch();

  const [mfaChallenge, setMfaChallenge] = useState<MfaChallengeResponse | null>(
    null,
  );
  const [remember, setRemember] = useState(false);
  const [directLoginDenied, setDirectLoginDenied] = useState(false);
  const [directLoginStatus, setDirectLoginStatus] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!userid) {
      return;
    }

    let cancelled = false;
    dispatch(
      sessionApi.endpoints.createSessionWithUserid.initiate(userid),
    ).then((result) => {
      if (cancelled || !("data" in result) || !result.data.matched) {
        if (!cancelled && "data" in result && !result.data.matched) {
          setDirectLoginDenied(true);
          setDirectLoginStatus(result.data.status ?? null);
        }
        return;
      }
      dispatch(completeLogin());
    });

    return () => {
      cancelled = true;
    };
  }, [dispatch, userid]);

  const handleSubmit = useCallback(
    async (data: LoginData) => {
      const { mfaChallenge: challenge } = await dispatch(
        login({ data, redirectUrl }),
      ).unwrap();
      if (challenge) {
        setRemember(Boolean(data.remember));
        setMfaChallenge(challenge);
      }
    },
    [dispatch, redirectUrl],
  );

  if (mfaChallenge) {
    return (
      <PLUGIN_MULTI_FACTOR_AUTH.AuthChallengeForm
        challengeToken={mfaChallenge.challenge_token}
        methods={mfaChallenge.methods}
        remember={remember}
        onCancel={() => setMfaChallenge(null)}
      />
    );
  }

  if (userid && directLoginDenied) {
    return (
      <Box role="alert" c="text-primary" ta="center">
        {directLoginStatus === 0
          ? t`User is not enabled. Please contact an administrator.`
          : directLoginStatus === 99
            ? t`User is disabled. Please contact an administrator.`
            : t`User does not exist. Please contact an administrator.`}
      </Box>
    );
  }

  return (
    <div>
      <LoginForm
        isLdapEnabled={isLdapEnabled}
        hasSessionCookies={hasSessionCookies}
        onSubmit={handleSubmit}
      />
      <ActionList>
        <ActionListItem>
          <AuthTextLink to="/auth/forgot_password">
            {t`I seem to have forgotten my password`}
          </AuthTextLink>
        </ActionListItem>
        {providers.map((provider) => (
          <ActionListItem key={provider.name}>
            <provider.Button redirectUrl={redirectUrl} />
          </ActionListItem>
        ))}
      </ActionList>
    </div>
  );
};
