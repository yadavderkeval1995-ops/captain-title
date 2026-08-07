import axios from "axios";

export const API_ROOT = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API_ROOT, withCredentials: true });

export const errorMessage = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg || "Invalid value").join(" · ");
  if (detail && typeof detail === "object") return detail.message || "Request could not be completed";
  return error?.message || "Something went wrong";
};