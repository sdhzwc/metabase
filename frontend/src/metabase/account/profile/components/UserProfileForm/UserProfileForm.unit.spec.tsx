import userEvent from "@testing-library/user-event";

import { renderWithProviders, screen } from "__support__/ui";
import { createMockState } from "metabase/redux/store/mocks";
import { createMockUser } from "metabase-types/api/mocks";

import type { UserProfileFormProps } from "./UserProfileForm";
import UserProfileForm from "./UserProfileForm";

const setup = (props: UserProfileFormProps) => {
  const state = createMockState();

  renderWithProviders(<UserProfileForm {...props} />, {
    storeInitialState: state,
  });
};

describe("UserProfileForm", () => {
  it("should show a success message after form submit", async () => {
    const props = getProps({
      onSubmit: jest.fn().mockResolvedValue({}),
    });

    setup(props);

    await userEvent.clear(screen.getByLabelText("First name"));
    await userEvent.type(screen.getByLabelText("First name"), "New name");
    await userEvent.click(screen.getByText("Update"));

    expect(await screen.findByText("Success")).toBeInTheDocument();
  });

  it("should submit nickname updates", async () => {
    const onSubmit = jest.fn().mockResolvedValue({});
    const props = getProps({ onSubmit });

    setup(props);

    await userEvent.type(screen.getByLabelText("Nickname"), "Nickname");
    await userEvent.click(screen.getByText("Update"));

    expect(onSubmit).toHaveBeenCalledWith(
      props.user,
      expect.objectContaining({ nickname: "Nickname" }),
    );
  });

  it("should allow SSO users to edit nickname", () => {
    setup(getProps({ isSsoUser: true }));

    expect(screen.getByLabelText("Nickname")).toBeInTheDocument();
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Last name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });
});

const getProps = (
  opts?: Partial<UserProfileFormProps>,
): UserProfileFormProps => ({
  user: createMockUser(),
  locales: null,
  isSsoUser: false,
  onSubmit: jest.fn(),
  ...opts,
});
