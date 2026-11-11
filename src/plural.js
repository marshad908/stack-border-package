/** "1 vendor", "3 vendors". Pass the plural form for words that do not just add an "s". */
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
