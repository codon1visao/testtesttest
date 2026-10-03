import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../app";

/** Renders the whole app (fresh providers and QueryClient) at a route, with a user-event session. */
export function renderApp(route = "/events/E101") {
  const user = userEvent.setup();
  return {
    user,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>,
    ),
  };
}
