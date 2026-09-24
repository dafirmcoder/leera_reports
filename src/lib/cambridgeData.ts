// Pre-seeded Cambridge Frameworks and Schemes of Work
// Including Cambridge Primary, Lower Secondary, IGCSE, and AS & A Level.
// Features comprehensive Global Perspectives Challenges and Learning Objectives.

export interface SeedSchemeDefinition {
  framework: 'CAMBRIDGE_PRIMARY' | 'CAMBRIDGE_LOWER_SECONDARY' | 'CAMBRIDGE_IGCSE' | 'CAMBRIDGE_AS_A_LEVEL'
  subject_code: string
  subject_name: string
  year_group: string
  title: string
  syllabus_years: string
  is_global_perspectives?: boolean
  topics: Array<{
    code: string
    title: string
    sequence: number
    is_challenge?: boolean
    description?: string
  }>
  objectives: Array<{
    topic_code?: string
    code: string
    text: string
    subtopic?: string
    challenge_title?: string
    sequence: number
  }>
}

export const CAMBRIDGE_PRESEEDED_SCHEMES: SeedSchemeDefinition[] = []
/*
  {
    framework: 'CAMBRIDGE_PRIMARY',
    subject_code: '0838',
    subject_name: 'Global Perspectives',
    year_group: 'Primary (Stages 1–6)',
    title: 'Cambridge Primary Global Perspectives (Stages 1–6)',
    syllabus_years: '2023-2027',
    is_global_perspectives: true,
    topics: [
      { code: 'GP-PRI-C01', title: 'Keeping Healthy', sequence: 1, is_challenge: true, description: 'Personal, local, and global habits for physical and mental wellbeing.' },
      { code: 'GP-PRI-C02', title: 'Looking After Planet Earth', sequence: 2, is_challenge: true, description: 'Environmental stewardship, waste, renewable nature, and conservation.' },
      { code: 'GP-PRI-C03', title: 'Sport and Recreation', sequence: 3, is_challenge: true, description: 'Role of play, sport, games, and teamwork in diverse cultures.' },
      { code: 'GP-PRI-C04', title: 'Values and Beliefs', sequence: 4, is_challenge: true, description: 'Understanding different worldviews, family traditions, and school rules.' },
      { code: 'GP-PRI-C05', title: 'Conflict and Peace', sequence: 5, is_challenge: true, description: 'Causes of disagreements and collaborative resolutions in daily life.' },
      { code: 'GP-PRI-C06', title: 'Moving Goods and People', sequence: 6, is_challenge: true, description: 'Transport, journeys, trade, and accessibility across communities.' },
      { code: 'GP-PRI-C07', title: 'The Right to Learn', sequence: 7, is_challenge: true, description: 'Education access, schools around the world, and digital learning.' },
      { code: 'GP-PRI-C08', title: 'Water, Food and Farming', sequence: 8, is_challenge: true, description: 'Clean water access, farming traditions, and balanced nutrition.' }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_LOWER_SECONDARY',
    subject_code: '1129',
    subject_name: 'Global Perspectives',
    year_group: 'Lower Secondary (Stages 7–9)',
    title: 'Cambridge Lower Secondary Global Perspectives (Stages 7–9)',
    syllabus_years: '2023-2027',
    is_global_perspectives: true,
    topics: [
      { code: 'GP-SEC-C01', title: 'Sustainable Living', sequence: 1, is_challenge: true, description: 'Responsible consumption, single-use plastics, and renewable energy models.' },
      { code: 'GP-SEC-C02', title: 'Digital World & Ethics', sequence: 2, is_challenge: true, description: 'Social media influence, digital divides, privacy, and online misinformation.' },
      { code: 'GP-SEC-C03', title: 'Health, Disease & Wellbeing', sequence: 3, is_challenge: true, description: 'Healthcare access, pandemic response, teenage mental health, and healthy diets.' },
      { code: 'GP-SEC-C04', title: 'Employment, Automation & Future of Work', sequence: 4, is_challenge: true, description: 'Youth employment trends, AI automation, and ethical work standards.' },
      { code: 'GP-SEC-C05', title: 'Migration, Urbanisation & Communities', sequence: 5, is_challenge: true, description: 'Urban sprawl, refugee migration, and inclusive city infrastructure.' },
      { code: 'GP-SEC-C06', title: 'Law, Justice & Human Rights', sequence: 6, is_challenge: true, description: 'Children’s rights, legal protections, and restorative justice models.' },
      { code: 'GP-SEC-C07', title: 'Tradition, Culture & Identity', sequence: 7, is_challenge: true, description: 'Indigenous cultures, language preservation, and cultural globalisation.' },
      { code: 'GP-SEC-C08', title: 'Water, Food Security & Biodiversity', sequence: 8, is_challenge: true, description: 'Sustainable agriculture, ocean protection, and drought resilience.' }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_IGCSE',
    subject_code: '0457',
    subject_name: 'Global Perspectives',
    year_group: 'Years 10–11 (IGCSE)',
    title: 'Cambridge IGCSE Global Perspectives (0457)',
    syllabus_years: '2025-2027',
    is_global_perspectives: true,
    topics: [
      { code: '0457-C01', title: 'Climate Change, Energy & Resources', sequence: 1, is_challenge: true, description: 'Greenhouse emissions, fossil fuels, renewable energy transitions, climate refugees.' },
      { code: '0457-C02', title: 'Digital World, AI & Social Media', sequence: 2, is_challenge: true, description: 'Algorithmic bias, data surveillance, cybersecurity, and synthetic media.' },
      { code: '0457-C03', title: 'Poverty, Wealth Inequality & Food Security', sequence: 3, is_challenge: true, description: 'Global distribution of wealth, fair trade, hunger crises, and economic safety nets.' },
      { code: '0457-C04', title: 'Conflict, Peace, Security & Disarmament', sequence: 4, is_challenge: true, description: 'Origins of armed conflicts, peacekeeping diplomacy, and humanitarian aid.' },
      { code: '0457-C05', title: 'Health, Pandemic Preparedness & Biotech', sequence: 5, is_challenge: true, description: 'Vaccine equity, genetic engineering ethics, mental health, universal healthcare.' },
      { code: '0457-C06', title: 'Human Rights, Migration & Rule of Law', sequence: 6, is_challenge: true, description: 'Universal human rights, asylum protocols, judicial corruption, freedom of speech.' },
      { code: '0457-C07', title: 'Sustainable Cities, Transport & Infrastructure', sequence: 7, is_challenge: true, description: 'Megacities, zero-carbon transit, waste management, rural depopulation.' },
      { code: '0457-C08', title: 'Education for All, Gender & Inclusivity', sequence: 8, is_challenge: true, description: 'Female literacy barriers, neurodivergent inclusion, and higher education access.' }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_AS_A_LEVEL',
    subject_code: '9239',
    subject_name: 'Global Perspectives & Research',
    year_group: 'AS & A Level (Years 12–13)',
    title: 'Cambridge International AS & A Level Global Perspectives & Research (9239)',
    syllabus_years: '2023-2027',
    is_global_perspectives: true,
    topics: [
      { code: '9239-C01', title: 'Global Economics, Transnational Trade & Aid', sequence: 1, is_challenge: true, description: 'Global supply chains, currency fluctuations, foreign debt, and WTO regulations.' },
      { code: '9239-C02', title: 'Artificial Intelligence, Ethics & Human Rights', sequence: 2, is_challenge: true, description: 'Autonomous weaponry, generative intelligence, neural privacy, and digital sovereignty.' },
      { code: '9239-C03', title: 'Medical Ethics, Bioengineering & Global Health', sequence: 3, is_challenge: true, description: 'CRISPR gene editing, clinical trials in developing nations, healthcare commodification.' },
      { code: '9239-C04', title: 'Geopolitics, Sovereignty, Climate Security & Conflict', sequence: 4, is_challenge: true, description: 'Resource nationalism, maritime borders, territorial disputes, and climate migration.' },
      { code: '9239-C05', title: 'Cultural Hegemony, Media Monopolies & Free Speech', sequence: 5, is_challenge: true, description: 'Concentration of media power, language endangerment, propaganda, and censorship.' }
    ],
    objectives: []
  },

  // =========================================================================
  // 2. MATHEMATICS (Primary, Lower Secondary, IGCSE, AS & A Level)
  // =========================================================================
  {
    framework: 'CAMBRIDGE_LOWER_SECONDARY',
    subject_code: '0862',
    subject_name: 'Mathematics',
    year_group: 'Lower Secondary (Stages 7–9)',
    title: 'Cambridge Lower Secondary Mathematics (0862)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '0862-T01', title: 'Number and Calculation', sequence: 1 },
      { code: '0862-T02', title: 'Algebra and Sequences', sequence: 2 },
      { code: '0862-T03', title: 'Geometry and Measure', sequence: 3 },
      { code: '0862-T04', title: 'Statistics and Probability', sequence: 4 }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_IGCSE',
    subject_code: '0580',
    subject_name: 'Mathematics',
    year_group: 'Years 10–11 (IGCSE)',
    title: 'Cambridge IGCSE Mathematics (0580)',
    syllabus_years: '2025-2027',
    topics: [
      { code: '0580-T01', title: 'Number and Ratio', sequence: 1 },
      { code: '0580-T02', title: 'Algebra and Graphs', sequence: 2 },
      { code: '0580-T03', title: 'Coordinate Geometry and Trigonometry', sequence: 3 },
      { code: '0580-T04', title: 'Probability and Statistics', sequence: 4 }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_AS_A_LEVEL',
    subject_code: '9709',
    subject_name: 'Mathematics',
    year_group: 'AS & A Level (Years 12–13)',
    title: 'Cambridge International AS & A Level Mathematics (9709)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '9709-P1', title: 'Pure Mathematics 1 (P1)', sequence: 1 },
      { code: '9709-P3', title: 'Pure Mathematics 3 (P3)', sequence: 2 },
      { code: '9709-M1', title: 'Mechanics (M1)', sequence: 3 },
      { code: '9709-S1', title: 'Probability & Statistics 1 (S1)', sequence: 4 }
    ],
    objectives: []
  },

  // =========================================================================
  // 3. SCIENCE (Lower Secondary, IGCSE, AS & A Level)
  // =========================================================================
  {
    framework: 'CAMBRIDGE_LOWER_SECONDARY',
    subject_code: '0893',
    subject_name: 'Science',
    year_group: 'Lower Secondary (Stages 7–9)',
    title: 'Cambridge Lower Secondary Science (0893)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '0893-BIO', title: 'Biology: Cells, Systems & Ecology', sequence: 1 },
      { code: '0893-CHM', title: 'Chemistry: Matter, Bonding & Reactions', sequence: 2 },
      { code: '0893-PHY', title: 'Physics: Forces, Energy & Waves', sequence: 3 },
      { code: '0893-EAS', title: 'Earth and Space Science', sequence: 4 }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_IGCSE',
    subject_code: '0610',
    subject_name: 'Biology',
    year_group: 'Years 10–11 (IGCSE)',
    title: 'Cambridge IGCSE Biology (0610)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '0610-T01', title: 'Characteristics and Classification of Living Organisms', sequence: 1 },
      { code: '0610-T02', title: 'Organisation of the Organism and Cells', sequence: 2 },
      { code: '0610-T03', title: 'Movement into and out of Cells: Diffusion, Osmosis & Active Transport', sequence: 3 },
      { code: '0610-T04', title: 'Biological Molecules and Enzymes', sequence: 4 },
      { code: '0610-T05', title: 'Plant Nutrition, Transport and Respiration', sequence: 5 }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_IGCSE',
    subject_code: '0620',
    subject_name: 'Chemistry',
    year_group: 'Years 10–11 (IGCSE)',
    title: 'Cambridge IGCSE Chemistry (0620)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '0620-T01', title: 'States of Matter and Kinetic Theory', sequence: 1 },
      { code: '0620-T02', title: 'Atoms, Elements, Compounds and Stoichiometry', sequence: 2 },
      { code: '0620-T03', title: 'Electrochemistry and Chemical Energetics', sequence: 3 },
      { code: '0620-T04', title: 'Chemical Reactions: Rates and Reversible Reactions', sequence: 4 },
      { code: '0620-T05', title: 'Acids, Bases, Salts and the Periodic Table', sequence: 5 }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_IGCSE',
    subject_code: '0625',
    subject_name: 'Physics',
    year_group: 'Years 10–11 (IGCSE)',
    title: 'Cambridge IGCSE Physics (0625)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '0625-T01', title: 'Motion, Forces and Energy', sequence: 1 },
      { code: '0625-T02', title: 'Thermal Physics and Kinetic Models', sequence: 2 },
      { code: '0625-T03', title: 'Waves: Light and Sound', sequence: 3 },
      { code: '0625-T04', title: 'Electricity and Magnetism', sequence: 4 },
      { code: '0625-T05', title: 'Nuclear Physics and Space Physics', sequence: 5 }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_AS_A_LEVEL',
    subject_code: '9702',
    subject_name: 'Physics',
    year_group: 'AS & A Level (Years 12–13)',
    title: 'Cambridge International AS & A Level Physics (9702)',
    syllabus_years: '2022-2026',
    topics: [
      { code: '9702-T01', title: 'Physical Quantities, Units & Kinematics', sequence: 1 },
      { code: '9702-T02', title: 'Dynamics, Forces, Momentum & Work', sequence: 2 },
      { code: '9702-T03', title: 'Waves, Superposition & Stationary Waves', sequence: 3 },
      { code: '9702-T04', title: 'Electric Fields, Current & DC Circuits', sequence: 4 },
      { code: '9702-T05', title: 'Nuclear Physics, Particle Physics & Quantum Quanta', sequence: 5 }
    ],
    objectives: []
  },

  // =========================================================================
  // 4. COMPUTER SCIENCE & COMPUTING (IGCSE & AS/A Level)
  // =========================================================================
  {
    framework: 'CAMBRIDGE_IGCSE',
    subject_code: '0478',
    subject_name: 'Computer Science',
    year_group: 'Years 10–11 (IGCSE)',
    title: 'Cambridge IGCSE Computer Science (0478)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '0478-T01', title: 'Data Representation: Binary, Hexadecimal & Data Types', sequence: 1 },
      { code: '0478-T02', title: 'Data Transmission, Networking & Error Checking', sequence: 2 },
      { code: '0478-T03', title: 'Hardware: CPU Architecture, Storage & Logic Gates', sequence: 3 },
      { code: '0478-T04', title: 'Software: Operating Systems, Translators & Security', sequence: 4 },
      { code: '0478-T05', title: 'Algorithm Design, Pseudocode & Programming Concepts', sequence: 5 }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_AS_A_LEVEL',
    subject_code: '9618',
    subject_name: 'Computer Science',
    year_group: 'AS & A Level (Years 12–13)',
    title: 'Cambridge International AS & A Level Computer Science (9618)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '9618-T01', title: 'Information Representation: Two’s Complement & Floating-Point', sequence: 1 },
      { code: '9618-T02', title: 'Communication, Internet Technologies & Protocols', sequence: 2 },
      { code: '9618-T03', title: 'Hardware, Processors, Pipelining & Assembly Language', sequence: 3 },
      { code: '9618-T04', title: 'Relational Database Modelling, Normalisation & SQL', sequence: 4 },
      { code: '9618-T05', title: 'Abstract Data Types: Stacks, Queues, Linked Lists & Binary Trees', sequence: 5 }
    ],
    objectives: []
  },

  // =========================================================================
  // 5. ENGLISH & HUMANITIES (Primary to AS/A Level)
  // =========================================================================
  {
    framework: 'CAMBRIDGE_LOWER_SECONDARY',
    subject_code: '0861',
    subject_name: 'English',
    year_group: 'Lower Secondary (Stages 7–9)',
    title: 'Cambridge Lower Secondary English (0861)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '0861-T01', title: 'Reading: Fiction and Poetry Analysis', sequence: 1 },
      { code: '0861-T02', title: 'Reading: Non-Fiction and Argumentative Texts', sequence: 2 },
      { code: '0861-T03', title: 'Writing: Narrative and Descriptive Prose', sequence: 3 },
      { code: '0861-T04', title: 'Writing: Persuasive and Informative Essays', sequence: 4 }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_IGCSE',
    subject_code: '0450',
    subject_name: 'Business Studies',
    year_group: 'Years 10–11 (IGCSE)',
    title: 'Cambridge IGCSE Business Studies (0450)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '0450-T01', title: 'Understanding Business Activity and Enterprise', sequence: 1 },
      { code: '0450-T02', title: 'People in Business: Motivation and Organisation', sequence: 2 },
      { code: '0450-T03', title: 'Marketing Strategy and Market Research', sequence: 3 },
      { code: '0450-T04', title: 'Operations Management and Quality Control', sequence: 4 },
      { code: '0450-T05', title: 'Financial Information and Cash Flow Decisions', sequence: 5 }
    ],
    objectives: []
  },
  {
    framework: 'CAMBRIDGE_AS_A_LEVEL',
    subject_code: '9708',
    subject_name: 'Economics',
    year_group: 'AS & A Level (Years 12–13)',
    title: 'Cambridge International AS & A Level Economics (9708)',
    syllabus_years: '2023-2027',
    topics: [
      { code: '9708-T01', title: 'Basic Economic Ideas, Scarcity & Resource Allocation', sequence: 1 },
      { code: '9708-T02', title: 'Price System: Microeconomic Demand, Supply & Elasticities', sequence: 2 },
      { code: '9708-T03', title: 'Government Microeconomic Intervention: Subsidies, Taxes & Maximum Prices', sequence: 3 },
      { code: '9708-T04', title: 'Macroeconomic Economy: Inflation, Balance of Payments & Employment', sequence: 4 },
      { code: '9708-T05', title: 'Government Macro Intervention: Monetary, Fiscal & Supply-Side Policies', sequence: 5 }
    ],
    objectives: []
  }
]
*/
