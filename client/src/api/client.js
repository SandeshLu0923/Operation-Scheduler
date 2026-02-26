import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: API_BASE_URL
});

// Add JWT token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("ot_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle token expiration
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("ot_token");
      localStorage.removeItem("ot_user");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;
