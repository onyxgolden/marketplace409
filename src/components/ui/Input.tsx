type InputProps = {
  label?: string;
  name?: string;
  type?: string;
  value?: string | number;
  placeholder?: string;
  required?: boolean;
  className?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

export default function Input({
  label,
  name,
  type = "text",
  value,
  placeholder,
  required = false,
  className = "",
  onChange,
}: InputProps) {
  return (
    <label className="block">
      {label && (
        <span className="block text-sm font-bold text-gray-700 mb-2 dark:text-slate-300">
          {label}
        </span>
      )}

      <input
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={onChange}
        className={`w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${className}`}
      />
    </label>
  );
}