import axios from "axios";

// Falls back to the local backend so a deploy without REACT_APP_BACKEND_URL
// set still works against `uvicorn` running on this machine.
export const API_ROOT = `${process.env.REACT_APP_BACKEND_URL || "http://localhost:8000"}/api`;
export const api = axios.create({ baseURL: API_ROOT, withCredentials: true });

export const errorMessage = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // A single bad value broadcast to every word (e.g. "Apply to All
    // Captions" with one out-of-range field) fails validation once per
    // word, not once overall - without deduping/capping, a toast ends up
    // showing the same message dozens of times over as one unreadable wall
    // of text instead of a single useful line.
    const messages = [...new Set(detail.map((item) => {
      const field = Array.isArray(item?.loc) ? item.loc[item.loc.length - 1] : null;
      return `${field ? `${field}: ` : ""}${item?.msg || "Invalid value"}`;
    }))];
    const shown = messages.slice(0, 3);
    if (messages.length > shown.length) shown.push(`+${messages.length - shown.length} more`);
    return shown.join(" · ");
  }
  if (detail && typeof detail === "object") return detail.message || "Request could not be completed";
  return error?.message || "Something went wrong";
};