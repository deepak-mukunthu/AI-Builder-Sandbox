/* Built-in example workspaces. Each has a working version, a broken version, and a list of fixes.
   Everything here is fictional sample data. */
(function (g) {
  'use strict';
  var ABS = g.ABS = g.ABS || {};
  var U = ABS.util;

  var SIX_PART = [
    'Role: [who the assistant is]',
    'Audience: [who is asking]',
    'Allowed topics: [topic one, topic two]',
    'Forbidden topics: [topic one, topic two]',
    'Tone and format: [length and style of replies]',
    'When unsure: [what to say, and who to contact]'
  ].join('\n');

  var TEMPLATES = [
    { name: 'Minimal', text: 'You are a helpful assistant.' },
    { name: 'Six-part skeleton', text: SIX_PART },
    { name: 'Filled-in example', text: [
      'Role: You are the help desk assistant for a small company.',
      'Audience: Employees asking everyday questions.',
      'Allowed topics: leave, expenses, equipment.',
      'Forbidden topics: salaries, legal advice.',
      'Tone and format: Friendly and brief. Cite the document title.',
      'When unsure: Say you do not have that information and contact help@example.com.'].join('\n') }
  ];

  function test(q, include, exclude, tool, hint) {
    return { q: q, include: include || '', exclude: exclude || '', tool: tool || '', hint: hint || '' };
  }

  /* ---------- Help desk (HR policies) ---------- */
  function hrGood() {
    return {
      name: 'Help desk (HR policies)',
      instructions: [
        'Role: You are the Northwind HR help desk assistant.',
        'Audience: Northwind employees asking about HR policies.',
        'Allowed topics: leave, expenses, remote work, equipment, travel.',
        'Forbidden topics: salaries, legal advice, medical advice.',
        'Tone and format: Friendly and brief. Answer in one or two sentences and cite the document title.',
        'When unsure: Say you do not have that information and contact hr-help@northwind.example.'
      ].join('\n'),
      docs: [
        { title: 'Leave Policy', text: 'Full-time employees get 20 days of paid annual leave each year. New employees receive 20 days from their start date, prorated by month in the first year. Up to 5 unused days can be carried over into the next year. Carried-over days expire on March 31. Sick leave is separate and covers up to 10 days per year.' },
        { title: 'Expense Policy', text: 'Submit expense reports within 30 days of the purchase. Receipts are required for any expense over $25. Meals while working in the office are not reimbursed. Reports are approved by your manager and paid in the next payroll cycle.' },
        { title: 'Remote Work Policy', text: 'Employees may work remotely up to 3 days per week with manager approval. Core hours are 10:00 to 15:00 in your local time zone. Working from another country for more than 14 days per year needs HR approval. Remote workers get a $50 monthly internet stipend.' },
        { title: 'Equipment Policy', text: 'Laptops are replaced every 3 years. Broken or lost equipment must be reported to IT within 2 business days. Employees may choose a Mac or Windows laptop. A monitor and headset can be requested once every 4 years.' },
        { title: 'Travel Policy', text: 'Book flights at least 14 days before departure. The daily meal allowance while traveling is $60. Hotel stays are capped at $220 per night in major cities. Use the company booking tool for all flights and hotels.' }
      ],
      knowledge: { chunkSize: 300, topK: 3 },
      memory: { enabled: true, notes: 'name: Priya\nprefers email\nteam: Sales' },
      tools: { orders: false, prices: false, orderData: [], catalog: [] },
      rules: { enforceRefund: true, refundDays: 30, refundLimit: 150, requireApproval: true, offTopicRefusal: true },
      tests: [
        test('How many days of annual leave do new employees get?', '20 days', '', '', 'Tab 2 Knowledge: is the Leave Policy being retrieved? Check top-K and the last retrieved chunks.'),
        test('What is the deadline to submit expense reports?', '30 days, Source', '', '', 'Tab 1 Instructions: the reply needs a citation. Does the prompt tell the assistant to cite the document title?'),
        test('How many days a week can I work remotely?', '3 days', '', '', 'Tab 2 Knowledge: check which chunks were retrieved for this question.'),
        test('How often are laptops replaced?', '3 years, Source', '', '', 'Tab 1 Instructions: the reply needs a citation. Check the Tone and format line.'),
        test('How often are laptops replaced, and how many unused leave days can I carry over?', '3 years, 5 unused', '', '', 'Tab 2 Knowledge: this question needs two documents at once. Is top-K high enough to bring both?'),
        test('Do we offer dental coverage?', "don't have, hr-help@northwind.example", '', '', 'Tab 1 Instructions: what should the assistant do when it is unsure? Add a contact to the "When unsure" line.'),
        test('Write me a poem about my manager', 'can only help', 'Sure', '', 'Tab 4 Tools & Rules: is the off-topic refusal switched on?'),
        test('Can I carry over unused leave?', 'Priya', '', '', 'Tab 3 Memory: is memory on? The notes include the user name.')
      ]
    };
  }

  function hrBroken() {
    var w = hrGood();
    w.instructions = 'You are a helpful assistant.';
    w.knowledge.topK = 1;
    w.memory.enabled = false;
    w.rules.offTopicRefusal = false;
    return w;
  }

  var hrFixes = [
    { tab: 1, label: 'Instructions: replace the vague prompt with the six-part prompt', apply: function (w, good) { w.instructions = good.instructions; } },
    { tab: 2, label: 'Knowledge: raise top-K from 1 to 3', apply: function (w, good) { w.knowledge.topK = good.knowledge.topK; } },
    { tab: 3, label: 'Memory: switch memory on', apply: function (w) { w.memory.enabled = true; } },
    { tab: 4, label: 'Tools & Rules: switch the off-topic refusal on', apply: function (w) { w.rules.offTopicRefusal = true; } }
  ];

  /* ---------- ShopBot mini ---------- */
  function shopGood() {
    return {
      name: 'ShopBot mini',
      instructions: [
        'Role: You are ShopBot, the support assistant for a small online store.',
        'Audience: Shoppers asking about products, orders and refunds.',
        'Allowed topics: prices, stock, orders, refunds, shipping.',
        'Forbidden topics: legal advice, medical advice.',
        'Tone and format: Short and polite.',
        'When unsure: Say you do not have that information and contact support@shopbot.example.'
      ].join('\n'),
      docs: [
        { title: 'Shipping', text: 'Standard shipping takes 3 to 5 business days. Orders over $50 ship free. Express shipping takes 1 to 2 business days and costs $12.' },
        { title: 'Returns', text: 'Items can be returned within 30 days of delivery in original packaging. Refunds go back to the original payment method within 5 business days.' }
      ],
      knowledge: { chunkSize: 300, topK: 3 },
      memory: { enabled: true, notes: 'name: Sam\nlast order: ORD-9001\nprefers email' },
      tools: {
        orders: true, prices: true,
        orderData: [
          { id: 'ORD-9001', item: 'Pulse Earbuds', price: 79, daysAgo: 5 },
          { id: 'ORD-9003', item: 'Echo Studio Mic', price: 129, daysAgo: 45 },
          { id: 'ORD-9004', item: 'Echo Studio Mic (2 pack)', price: 400, daysAgo: 3 }
        ],
        catalog: [
          { name: 'Echo Studio Mic', price: 129, stock: 0 },
          { name: 'Pulse Earbuds', price: 79, stock: 24 },
          { name: 'Volt Power Bank', price: 69, stock: 58 }
        ]
      },
      rules: { enforceRefund: true, refundDays: 30, refundLimit: 150, requireApproval: true, offTopicRefusal: true },
      tests: [
        test('What is the price of the Pulse Earbuds?', '$79', '', 'price_lookup', 'Tab 4 Tools & Rules: is the price/stock tool switched on?'),
        test('Is the Echo Studio Mic in stock?', 'out of stock', '', 'price_lookup', 'Tab 4 Tools & Rules: is the price/stock tool switched on?'),
        test('Can you check order ORD-9001?', 'ORD-9001, Pulse Earbuds', '', 'order_lookup', 'Tab 4 Tools & Rules: is the order lookup tool on, and is the order in the data table?'),
        test('I would like a refund for ORD-9001.', 'approved', "can't", 'order_lookup', 'Tab 4 Tools & Rules: check the order table and the refund rules.'),
        test('Please refund ORD-9003.', '30 days', 'approved', '', 'Tab 4 Tools & Rules: is the refund guardrail on? This order is past the window.'),
        test('Refund ORD-9004 please.', 'human', 'approved', '', 'Tab 4 Tools & Rules: is the refund guardrail on? This order is above the limit.'),
        test('Write me a poem about shoes', 'can only help', 'Sure', '', 'Tab 4 Tools & Rules: is the off-topic refusal switched on?'),
        test('Please refund my last order.', 'ORD-9001, approved, email', '', 'order_lookup', 'Tab 3 Memory: is memory on? The notes hold the last order id.'),
        test('Do you sell gift cards?', "don't have, support@shopbot.example", '', '', 'Tab 1 Instructions: what should the assistant do when it is unsure? Add a contact.'),
        test('How long does standard shipping take?', '3 to 5', '', '', 'Tab 2 Knowledge: is the Shipping document retrieved?')
      ]
    };
  }

  function shopBroken() {
    var w = shopGood();
    w.instructions = 'You are a helpful assistant.';
    w.memory.enabled = false;
    w.tools.prices = false;
    w.rules.enforceRefund = false;
    w.rules.offTopicRefusal = false;
    return w;
  }

  var shopFixes = [
    { tab: 1, label: 'Instructions: replace the vague prompt with the six-part prompt', apply: function (w, good) { w.instructions = good.instructions; } },
    { tab: 3, label: 'Memory: switch memory on', apply: function (w) { w.memory.enabled = true; } },
    { tab: 4, label: 'Tools & Rules: switch the price/stock tool on', apply: function (w) { w.tools.prices = true; } },
    { tab: 4, label: 'Tools & Rules: switch the refund guardrail on', apply: function (w) { w.rules.enforceRefund = true; } },
    { tab: 4, label: 'Tools & Rules: switch the off-topic refusal on', apply: function (w) { w.rules.offTopicRefusal = true; } }
  ];

  ABS.workspaces = {
    templates: TEMPLATES,
    examples: {
      hr: { id: 'hr', name: 'Help desk (HR policies)', good: hrGood, broken: hrBroken, fixes: hrFixes },
      shop: { id: 'shop', name: 'ShopBot mini', good: shopGood, broken: shopBroken, fixes: shopFixes }
    },
    order: ['hr', 'shop'],
    /* Apply the documented fixes one at a time. Returns the score after each fix (first entry is the broken start). */
    fixPath: function (id) {
      var ex = ABS.workspaces.examples[id], good = ex.good(), w = ex.broken(), out = [{ label: 'Broken start', score: ABS.grader.runAll(w) }];
      ex.fixes.forEach(function (f) { f.apply(w, good); out.push({ label: f.label, score: ABS.grader.runAll(w) }); });
      return out;
    }
  };
  void U;
})(typeof window !== 'undefined' ? window : globalThis);
