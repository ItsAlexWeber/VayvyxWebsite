import { useState, type ChangeEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoComplete?: string;
  helpText?: string;
  fieldClassName?: string;
};

export function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  autoComplete = "new-password",
  helpText,
  fieldClassName = "access-field",
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  function toggleVisibility() {
    setIsVisible((current) => !current);
  }

  return (
    <div className={`${fieldClassName} password-field`}>
      <span>
        <label htmlFor={id}>{label}</label>
      </span>

      <div className="password-input-shell">
        <input
          id={id}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={handleChange}
          placeholder="Enter new password"
          autoComplete={autoComplete}
          disabled={disabled}
        />

        <button
          className="password-visibility-button"
          type="button"
          onClick={toggleVisibility}
          aria-label={isVisible ? "Hide password" : "Show password"}
          title={isVisible ? "Hide password" : "Show password"}
          disabled={disabled}
        >
          {isVisible ? (
            <EyeOff aria-hidden="true" size={17} strokeWidth={2.15} />
          ) : (
            <Eye aria-hidden="true" size={17} strokeWidth={2.15} />
          )}
        </button>
      </div>

      {helpText && <small>{helpText}</small>}
    </div>
  );
}
