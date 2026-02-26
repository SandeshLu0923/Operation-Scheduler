// Basic email validation
export function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

// Basic password validation
export function validatePassword(password) {
  if (password.length < 6) return "Password must be at least 6 characters";
  if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
  if (!/[0-9]/.test(password)) return "Password must contain a number";
  return null;
}

// Phone number validation
export function validatePhone(phone) {
  const re = /^[0-9]{10}$/;
  return re.test(String(phone).replace(/\D/g, ""));
}

// Date validation (not in past)
export function validateFutureDate(dateString) {
  const date = new Date(dateString);
  return date > new Date();
}

// Generic required field
export function validateRequired(value) {
  return value && String(value).trim().length > 0;
}

// Form validation helper
export function validateForm(data, rules) {
  const errors = {};
  
  Object.keys(rules).forEach((field) => {
    const value = data[field];
    const rule = rules[field];
    
    if (rule.required && !validateRequired(value)) {
      errors[field] = `${rule.label || field} is required`;
    } else if (rule.type === "email" && value && !validateEmail(value)) {
      errors[field] = `${rule.label || field} is not a valid email`;
    } else if (rule.minLength && String(value).length < rule.minLength) {
      errors[field] = `${rule.label || field} must be at least ${rule.minLength} characters`;
    } else if (rule.maxLength && String(value).length > rule.maxLength) {
      errors[field] = `${rule.label || field} must be no more than ${rule.maxLength} characters`;
    } else if (rule.pattern && !rule.pattern.test(value)) {
      errors[field] = rule.message || `${rule.label || field} is invalid`;
    }
  });
  
  return errors;
}
