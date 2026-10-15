const countries = require('../data/countries.json');
const keyOf = value => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const names = new Map(countries.flatMap(country => [country.name, ...country.aliases].map(name => [keyOf(name), country.name])));
function normalizeNationality(value) {
  return typeof value === 'string' ? names.get(keyOf(value)) || '' : '';
}
const nationalities = [...countries].sort((a, b) => a.code === 'VN' ? -1 : b.code === 'VN' ? 1 : a.name.localeCompare(b.name, 'vi'));
module.exports = { nationalities, normalizeNationality };
