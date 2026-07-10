import React from 'react';

const FilterDropdown = ({ label, value, onChange, options, className }) => {
  return (
    <div className="filter-input-gold">
      <label>{label}</label>
      <select 
        className={className} 
        value={value} 
        onChange={onChange}
      >
        <option value="">All {label}s</option>
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
};

export default FilterDropdown;