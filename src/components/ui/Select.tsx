type SelectOption = {
  label: string;
  value: string;
};

type SelectProps = {
  label?: string;
  name?: string;
  value?: string;
  options: SelectOption[];
  required?: boolean;
  className?: string;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
};

export default function Select({
  label,
  name,
  value,
  options,
  required = false,
  className = "",
  onChange,
}: SelectProps) {
  return (
    <label className="block">
      {label && (
        <span className="block text-sm font-bold text-gray-700 mb-2 dark:text-slate-300">
          {label}
        </span>
      )}

      <select
        name={name}
        value={value}
        required={required}
        onChange={onChange}
        className={`w-full rounded-xl border border-gray-300 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${className}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}