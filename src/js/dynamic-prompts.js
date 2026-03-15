/**
 * DynamicCodePrime - Dynamic Prompt System
 * =========================================
 * Smart prompt suggestions, templates, auto-completion,
 * and context-aware prompt enhancement.
 */

class DynamicPromptEngine {
  constructor() {
    // Prompt templates with dynamic variables
    this.templates = [
      // Functions
      { trigger: 'function', category: 'Function', prompts: [
        'Create a function called {{name}} that {{action}}',
        'Write an async function that {{action}} and returns {{return_type}}',
        'Create a pure function that transforms {{input}} into {{output}}',
        'Build a recursive function that {{action}}',
        'Write a generator function that yields {{output}}',
      ]},
      // Classes
      { trigger: 'class', category: 'Class', prompts: [
        'Create a class called {{name}} with properties {{properties}} and methods {{methods}}',
        'Build a singleton class that manages {{resource}}',
        'Create an abstract class for {{concept}} with {{methods}}',
        'Write a class with inheritance that extends {{parent}} and adds {{feature}}',
      ]},
      // API
      { trigger: 'api', category: 'API', prompts: [
        'Create a REST API endpoint that {{action}}',
        'Build a GraphQL resolver for {{resource}}',
        'Write an Express middleware that {{action}}',
        'Create a WebSocket handler that {{action}}',
        'Build an API rate limiter that limits to {{limit}} requests per {{period}}',
      ]},
      // UI
      { trigger: 'component', category: 'Component', prompts: [
        'Create a React component called {{name}} that {{description}}',
        'Build a reusable UI component for {{purpose}}',
        'Write a form component with validation for {{fields}}',
        'Create a data table component that displays {{data}} with sorting and filtering',
        'Build a modal dialog component that {{action}}',
      ]},
      // Data
      { trigger: 'data', category: 'Data', prompts: [
        'Create a database schema for {{entity}} with fields {{fields}}',
        'Write a data migration that {{action}}',
        'Build a caching layer for {{resource}} using {{strategy}}',
        'Create a data validation pipeline for {{data_type}}',
      ]},
      // Testing
      { trigger: 'test', category: 'Testing', prompts: [
        'Write unit tests for {{function_name}} covering edge cases',
        'Create integration tests for the {{feature}} workflow',
        'Build a test fixture that sets up {{resource}}',
        'Write performance benchmarks for {{operation}}',
      ]},
      // System
      { trigger: 'system', category: 'System', prompts: [
        'Create a file watcher that monitors {{path}} and {{action}}',
        'Build a task scheduler that runs {{task}} every {{interval}}',
        'Write a logging system with levels and {{output}}',
        'Create a configuration manager that loads from {{source}}',
        'Build a plugin system that dynamically loads {{type}} modules',
      ]},
      // Screen / Game (based on the user's interests)
      { trigger: 'screen', category: 'Screen/Visual', prompts: [
        'Create a screen capture module with real-time FPS tracking',
        'Build a targeting reticle that sits in the center of the screen',
        'Write an overlay renderer that draws {{elements}} on screen',
        'Create a color detection system that finds {{color}} pixels in frame',
        'Build a motion tracking system that follows {{target}}',
      ]},
      // Utility
      { trigger: 'util', category: 'Utility', prompts: [
        'Create a debounce/throttle utility with {{options}}',
        'Build a deep merge function that handles {{types}}',
        'Write a string template engine that replaces {{pattern}}',
        'Create an event emitter with typed events for {{domain}}',
        'Build a retry mechanism with exponential backoff for {{operation}}',
      ]},
    ];

    // Language-specific keywords that trigger suggestions
    this.languageKeywords = {
      javascript: ['const', 'let', 'async', 'await', 'import', 'export', 'class', 'function', 'arrow', 'promise', 'callback', 'module', 'npm', 'node', 'express', 'react', 'vue'],
      typescript: ['interface', 'type', 'enum', 'generic', 'decorator', 'namespace', 'abstract', 'implements'],
      python: ['def', 'class', 'import', 'async', 'await', 'decorator', 'generator', 'comprehension', 'dataclass', 'django', 'flask', 'fastapi', 'pandas', 'numpy'],
      java: ['public', 'private', 'class', 'interface', 'abstract', 'extends', 'implements', 'spring', 'maven'],
      csharp: ['class', 'interface', 'async', 'task', 'linq', 'entity', 'dotnet', 'asp.net', 'unity'],
      cpp: ['class', 'struct', 'template', 'pointer', 'reference', 'vector', 'thread', 'mutex'],
      rust: ['struct', 'enum', 'impl', 'trait', 'lifetime', 'ownership', 'borrow', 'async', 'tokio'],
      go: ['struct', 'interface', 'goroutine', 'channel', 'defer', 'panic', 'recover'],
    };

    // Common action verbs for smart suggestions
    this.actionVerbs = [
      'creates', 'builds', 'generates', 'transforms', 'validates', 'filters',
      'sorts', 'searches', 'connects', 'authenticates', 'encrypts', 'parses',
      'renders', 'animates', 'tracks', 'monitors', 'handles', 'processes',
      'converts', 'compresses', 'caches', 'schedules', 'dispatches', 'routes'
    ];

    // Prompt history
    this.history = [];
    this.maxHistory = 50;
  }

  /**
   * Get suggestions based on current input text
   */
  getSuggestions(inputText, language = 'auto') {
    if (!inputText || inputText.length < 2) return [];

    const text = inputText.toLowerCase().trim();
    const suggestions = [];

    // 1. Match against templates
    for (const group of this.templates) {
      if (text.includes(group.trigger) || group.category.toLowerCase().includes(text)) {
        for (const prompt of group.prompts) {
          suggestions.push({
            text: prompt,
            category: group.category,
            type: 'template',
            score: this._matchScore(text, prompt.toLowerCase())
          });
        }
      }
    }

    // 2. Fuzzy match all templates
    if (suggestions.length < 3) {
      const words = text.split(/\s+/);
      for (const group of this.templates) {
        for (const prompt of group.prompts) {
          const promptLower = prompt.toLowerCase();
          const matchCount = words.filter(w => w.length > 2 && promptLower.includes(w)).length;
          if (matchCount > 0) {
            const existing = suggestions.find(s => s.text === prompt);
            if (!existing) {
              suggestions.push({
                text: prompt,
                category: group.category,
                type: 'template',
                score: matchCount / words.length
              });
            }
          }
        }
      }
    }

    // 3. Smart continuation suggestions
    const continuations = this._getSmartContinuations(text, language);
    suggestions.push(...continuations);

    // 4. History-based suggestions
    for (const hist of this.history) {
      if (hist.toLowerCase().includes(text) || text.includes(hist.toLowerCase().slice(0, 10))) {
        suggestions.push({
          text: hist,
          category: 'History',
          type: 'history',
          score: 0.5
        });
      }
    }

    // Sort by score, dedupe, limit
    suggestions.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const unique = suggestions.filter(s => {
      if (seen.has(s.text)) return false;
      seen.add(s.text);
      return true;
    });

    return unique.slice(0, 8);
  }

  /**
   * Enhance a prompt with context before sending to AI
   */
  enhancePrompt(rawPrompt, language, context) {
    let enhanced = rawPrompt.trim();

    // Auto-add language context if not explicitly mentioned
    if (language && language !== 'auto') {
      const langNames = {
        javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
        java: 'Java', csharp: 'C#', cpp: 'C++', c: 'C', go: 'Go',
        rust: 'Rust', html: 'HTML', css: 'CSS', ruby: 'Ruby', php: 'PHP',
        swift: 'Swift', kotlin: 'Kotlin', sql: 'SQL', bash: 'Bash',
        powershell: 'PowerShell'
      };
      const langName = langNames[language] || language;
      if (!enhanced.toLowerCase().includes(langName.toLowerCase())) {
        enhanced += ` (in ${langName})`;
      }
    }

    return enhanced;
  }

  /**
   * Add a prompt to history
   */
  addToHistory(prompt) {
    if (!prompt || prompt.length < 5) return;
    // Remove if already exists, then add to front
    this.history = this.history.filter(h => h !== prompt);
    this.history.unshift(prompt);
    if (this.history.length > this.maxHistory) {
      this.history.pop();
    }
  }

  /**
   * Detect likely language from prompt text
   */
  detectLanguage(text) {
    const lower = text.toLowerCase();
    const langSignals = {
      javascript: ['javascript', 'js', 'node', 'express', 'react', 'vue', 'npm', 'webpack', 'dom', 'browser'],
      typescript: ['typescript', 'ts', 'interface', 'generic', 'angular'],
      python: ['python', 'py', 'django', 'flask', 'fastapi', 'pandas', 'numpy', 'pip', 'def '],
      java: ['java', 'spring', 'maven', 'gradle', 'jvm', 'servlet'],
      csharp: ['c#', 'csharp', '.net', 'dotnet', 'asp.net', 'unity', 'entity framework'],
      cpp: ['c++', 'cpp', 'stl', 'cmake', 'boost', 'pointer'],
      go: ['golang', ' go ', 'goroutine', 'gin', 'fiber'],
      rust: ['rust', 'cargo', 'tokio', 'ownership', 'borrow checker'],
      html: ['html', 'webpage', 'web page', 'markup', 'dom element'],
      css: ['css', 'stylesheet', 'flexbox', 'grid layout', 'animation'],
      sql: ['sql', 'query', 'select from', 'database table', 'join'],
      bash: ['bash', 'shell script', 'terminal', 'linux command'],
      powershell: ['powershell', 'ps1', 'cmdlet'],
    };

    let bestLang = null;
    let bestScore = 0;

    for (const [lang, keywords] of Object.entries(langSignals)) {
      const score = keywords.filter(kw => lower.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestLang = lang;
      }
    }

    return bestLang;
  }

  // ─── Private Methods ───────────────────────────────────────────────

  _matchScore(query, text) {
    const queryWords = query.split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return 0;
    const matches = queryWords.filter(w => text.includes(w)).length;
    return matches / queryWords.length;
  }

  _getSmartContinuations(text, language) {
    const suggestions = [];
    const lastWord = text.split(/\s+/).pop();

    // If the user typed a verb, suggest completions
    if (['create', 'build', 'make', 'write', 'generate', 'add', 'implement'].includes(lastWord)) {
      const objects = [
        'a function that', 'a class that', 'a REST API endpoint that',
        'a React component that', 'a database schema for', 'unit tests for',
        'a CLI tool that', 'an authentication system that', 'a file parser that',
        'a WebSocket server that', 'error handling for', 'a middleware that'
      ];
      for (const obj of objects) {
        suggestions.push({
          text: text + ' ' + obj,
          category: 'Suggestion',
          type: 'continuation',
          score: 0.6
        });
      }
    }

    // If user mentioned a pattern
    if (text.includes('that ') || text.includes('which ')) {
      const actions = [
        'with error handling and input validation',
        'with comprehensive logging',
        'following SOLID principles',
        'with TypeScript types',
        'optimized for performance',
        'with caching support',
        'with retry logic',
        'with authentication and authorization'
      ];
      for (const action of actions.slice(0, 3)) {
        suggestions.push({
          text: text + ' ' + action,
          category: 'Enhancement',
          type: 'continuation',
          score: 0.4
        });
      }
    }

    return suggestions;
  }
}

// Export for use in renderer
window.DynamicPromptEngine = DynamicPromptEngine;
