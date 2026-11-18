import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { normalizeDashboardUrl } from "./route";
import {AccountBoundary} from './account/AccountBoundary';
import {ACCOUNT_MODE} from './account/storage';

normalizeDashboardUrl();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {ACCOUNT_MODE?<AccountBoundary><App /></AccountBoundary>:<App />}
  </StrictMode>,
);
