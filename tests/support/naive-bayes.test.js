// Thí nghiệm Naive Bayes (Task 8.8, spec D2): bộ phân loại tự huấn luyện trên tiêu đề, từ khóa và câu nửa luyện,
// so với cách tìm theo từ khóa trên nửa kiểm. Chỉ là thí nghiệm có đo, bot vẫn dùng rankArticles.
const test = require('node:test');
const assert = require('node:assert/strict');
const { features, buildTrainingSet, trainNaiveBayes, classify, mcnemarExact } = require('../../scripts/experimentNaiveBayes');
const { seedArticles } = require('../../src/backend/services/supportKnowledge');
const items = require('../helpers/supportEvalSet.json');

test('features lấy các âm tiết đã bỏ dấu và các cặp âm tiết liền nhau', () => {
  assert.deepEqual(features('Giữ chỗ bao lâu?'), ['giu', 'cho', 'bao', 'lau', 'giu cho', 'cho bao', 'bao lau']);
  assert.deepEqual(features('  '), []);
});

test('huấn luyện trên hai chủ đề thì "giữ chỗ" ra hold', () => {
  const model = trainNaiveBayes([{ text: 'giu cho bao lau', label: 'hold' }, { text: 'nap vi', label: 'wallet' }]);
  assert.equal(classify(model, 'giữ chỗ', { threshold: 0.5 }), 'hold');
  assert.equal(classify(model, 'nạp ví', { threshold: 0.5 }), 'wallet');
});

test('độ tin thấp hoặc câu không có chữ nào đã học thì trả null', () => {
  const model = trainNaiveBayes([{ text: 'giu cho bao lau', label: 'hold' }, { text: 'nap vi', label: 'wallet' }]);
  assert.equal(classify(model, 'thời tiết hôm nay', { threshold: 0.5 }), null);
  assert.equal(classify(model, 'giữ chỗ', { threshold: 0.999 }), null);
});

test('buildTrainingSet không chứa câu nào của nửa kiểm', () => {
  const docs = buildTrainingSet(seedArticles(), items);
  const kiem = new Set(items.filter(item => item.split === 'kiem').map(item => item.question));
  assert.ok(docs.length > 0);
  assert.ok(docs.every(doc => !kiem.has(doc.text)));
  // Có câu nửa luyện (đã gắn bài) và có từ khóa của bài.
  const luyen = items.find(item => item.split === 'luyen' && item.expected === 'hold');
  assert.ok(docs.some(doc => doc.text === luyen.question && doc.label === 'hold'));
  assert.ok(docs.some(doc => doc.label === 'wallet' && doc.text === seedArticles().find(a => a.key === 'wallet').terms[0]));
  // Câu null và câu tác vụ không có nhãn bài nên không vào tập huấn luyện.
  assert.ok(docs.every(doc => doc.label && !String(doc.label).startsWith('task:')));
});

test('kiểm định McNemar chính xác: 6–0 có ý nghĩa ở mức 5%, 7–1 thì chưa', () => {
  assert.ok(mcnemarExact(6, 0) < 0.05);
  assert.ok(mcnemarExact(7, 1) > 0.05);
  assert.equal(mcnemarExact(0, 0), 1);
});
