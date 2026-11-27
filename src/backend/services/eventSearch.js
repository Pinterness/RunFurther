const { escapeRegex } = require('../lib/errors');
const vowels = { a:'aàáạảãâầấậẩẫăằắặẳẵ', e:'eèéẹẻẽêềếệểễ', i:'iìíịỉĩ', o:'oòóọỏõôồốộổỗơờớợởỡ', u:'uùúụủũưừứựửữ', y:'yỳýỵỷỹ', d:'dđ' };
function words(value) {
  return String(value || '').slice(0,120).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0,8);
}
function pattern(value) {
  return [...value].map(c => (vowels[c] ? '['+vowels[c]+']' : escapeRegex(c))+'[\u0300-\u036f]*').join('');
}
const fields = ['name','location.city','location.venue'];
function searchConditions(value, paths = fields) {
  return words(value).map(word => ({ $or: paths.map(path => ({ [path]: { $regex:pattern(word), $options:'i' } })) }));
}
function relevance(value) {
  const phrase=words(value).map(pattern).join('\\s+');
  const match=(field, regex, weight)=>({ $cond:[{$regexMatch:{input:{$ifNull:['$'+field,'']},regex,options:'i'}},weight,0] });
  return { $add:[match('name','^'+phrase+'$',80),match('name',phrase,40),match('location.city',phrase,30),match('location.venue',phrase,10),...words(value).flatMap(word=>fields.map((field,i)=>match(field,pattern(word),[8,5,2][i])))] };
}
module.exports={words,pattern,searchConditions,relevance};
