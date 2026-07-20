# OMNI-PERFORM 完整测试物料包 — 供外部 AI（ChatGPT Codex）审查使用

**日期:** 2026-07-17  
**目的:** 将本项目所有语音评测功能的确定性测试集、回归守卫、对抗用例、以及已知缺陷整理为单一文档，供外部 AI 独立运行测试、验证产品声称、发现未覆盖的漏洞。

---

## 目录

1. [应用架构概览](#1-应用架构概览)
2. [六个受测语音功能](#2-六个受测语音功能)
3. [完整确定性测试语料库](#3-完整确定性测试语料库)
4. [两个已部署修复的回归测试](#4-两个已部署修复的回归测试)
5. [对抗测试用例（攻击面）](#5-对抗测试用例攻击面)
6. [已知缺陷与未实现功能](#6-已知缺陷与未实现功能)
7. [运行测试命令](#7-运行测试命令)
8. [评估框架（外部数据 + 金标研究）](#8-评估框架外部数据--金标研究)

---

## 1. 应用架构概览

### 技术栈
- **前端:** React + Vite（`client/`）
- **后端:** Node.js Express（`server/`）
- **语音转录:** Groq Whisper (`whisper-large-v3`), 语言锁定为 `de`
- **语法检查:** LanguageTool（唯一声称来源）
- **语音活跃检测:** `audioGuard.js` — 纯PCM16 RMS能量检测（防止Whisper从静音中幻觉文本）
- **音频格式:** 24kHz 单声道 WAV（44字节RIFF头 + PCM16）

### 核心设计原则
所有语音功能的评分均基于 **确定性规则**（正则 + 词重叠 + 定时），无模型意见。任何声称「发音」的内容均被故意移除——STT 转录抹去了口音信息，因此服务器无法听到声音，不应假装能评判发音。

### 关键文件映射

| 功能 | 服务端评分逻辑 | 客户端UI | 服务端回归测试 | 准确性语料库 |
|------|--------------|---------|-------------|------------|
| Shadowing（跟读） | `server/shadowing.js` | `client/src/Shadowing.jsx` | — | — |
| Sag es richtig（口语SRS） | `server/spokenReview.js` | `client/src/SpokenReview.jsx` | — | — |
| Flow-Drill（4-3-2流利度） | `server/fluencyDrill.js` | `client/src/FluencyDrill.jsx` | `server/fluencyDrill.test.mjs` | — |
| Blitz-Formeln（公式块） | `server/fluencyDrill.js` (chunks) | `client/src/FluencyDrill.jsx` | `server/chunkAutomaticity.test.mjs` | — |
| 语法检测 | `server/scoring/l1Errors.js` | — | `server/scoring/l1Errors.test.mjs` | `server/scoring/grammarAccuracy.test.mjs` |
| 瓶颈诊断 | `server/scoring/l1Errors.js` | — | — | `server/scoring/bottleneckAccuracy.test.mjs` |
| STT截断检测 | `server/scoring/turnQuality.js` | — | `server/scoring/turnQuality.test.mjs` | `server/scoring/sttTrustAccuracy.test.mjs` |
| 录用就绪判定 | `server/hireReadiness.js` | — | `server/hireReadiness.test.mjs` | `server/scoring/hireReadinessAccuracy.test.mjs` |
| 结构优势检测 | `server/scoring/structureWins.js` | — | — | `server/scoring/structureWins.test.mjs` |
| 语言/脚本守卫 | `server/langGuard.js` | — | `server/langGuard.test.mjs` | — |
| 转录守卫 | `server/transcriptGuard.js` | — | `server/transcriptGuard.test.mjs` | — |
| 音频守卫 | `server/audioGuard.js` | — | — | — |

---

## 2. 六个受测语音功能

### 2.1 Shadowing（跟读训练）

**端点:** `GET /api/shadowing` → 3-5句德语 → `POST /api/shadowing/score` → 词准确率%

**评分方式:**
- 转录文本 vs 目标句子的词集合重叠（`wordAccuracy()`）
- 纯集合匹配：转录中出现的目标词 / 目标词总数 = 匹配%
- 无编辑距离容错，无词序要求

**诚实地不声称什么:**
- 不声称评判发音（代码注释明确说明）
- 旧版LLM生成的"Aussprache提示"已被移除（它在评判服务器从未听到的声音）

### 2.2 Sag es richtig（口语间隔重复）

**端点:** `GET /api/spoken-review` → 待练项目（语法+短语） → `POST /api/spoken-review/grade` → 正确/错误

**评分方式 (`gradeSpoken()`):**
- **语法项目:** 目标token是否出现在转录中，1编辑距离容错（仅对≥3字符token），但容错永不接受实际错误token
- **短语项目:** 内容词重叠 ≥70%（词长 > 2）
- **ERROR-REPAIR守卫:** 如果转录与错误句子的距离 ≤ 与正确句子的距离 → 拒绝（不能把正确词塞进错误句子里就通过）
- **语音门:** 有声时长 < 600ms → 拒绝（`retry: true`）

### 2.3 Flow-Drill（4-3-2 流利度训练）

**端点:** `GET /api/fluency` → 1个话题 + `[90,60,45]`轮次 → `POST /api/fluency/score` → 指标

**测量的指标（纯确定性，来自转录 + 计时）:**
- 词数、有声时长、词/分钟（从有声时间计算，非麦克风开启时间）
- 填充词计数（仅无歧义的：äh, ähm, etc. — 排除auch, ja, halt等合法词）
- 唯一词数、从句率（子句复杂度）
- **话题相关度**（内容词重叠，5字符德语词干匹配）
- **语法**（仅LanguageTool，仅最后一轮 — 不打断流利度推进）

### 2.4 Blitz-Formeln（公式块自动化）

**端点:** `GET /api/fluency/chunks` → 8个待练块 → `POST /api/fluency/chunks/score` → 命中/未命中 + 延迟判定

**评分方式:**
- **存在性:** `chunkMatch()` — 所有目标token必须在转录中按序出现（`isCorrect()` 每词，来自srs.js的单规则：精确匹配或≥4字符1编辑容错）
- **延迟判定 (ms 从开麦到首有声帧):** ≤1500ms = automatic, ≤3000ms = ok, >3000ms = slow
- **SRS:** 1→3→7→14→30天间隔，错过 = 重置为1

### 2.5 L1错误检测（阿拉伯语母语者特征模式）

**纯正则 + 词表检测（`detectL1Patterns()`）:**
1. **verb-final**: 从句中动词第二位（"weil ich *habe* keine Zeit"）
2. **article-gender**: 不可能性冠词错误（"die Problem" — die对该名词任何格都不合法）
3. **p-b**: 转录中P→B清音化伪影（阿拉伯语无声/p/ → STT写B — "broblem"不是德语词）

**诚实门:**
- 仅≥2次出现 = 命名模式
- 截断回合永不引用（防误责学习者）
- 低置信词永不引用（防将STT误听归咎于学习者）
- wenn的子句中动词第二位且末位有语气动词/助动词 → 不过度标记（"weil ich arbeiten *muss*"已是正确的）

### 2.6 录用就绪判定 (`hireReadiness.js`)

**门控条件:**
- level ≥ B1（CEFR估计）
- intelligibility ≥ 0.7
- deescalation ≥ 0.5
- giveUpRate ≤ 0.3
- wpm ≥ 90

任一门槛不达标 → `hireReady = false`

---

## 3. 完整确定性测试语料库

### 3.1 语法准确性语料库（`server/scoring/grammarAccuracy.test.mjs`）

**零幻觉守卫（必须为0）:** 正确的德语永不被标记。  
**当前语料:** 35条样本

#### verb-final 错误（必须捕获）
```
'weil ich habe keine Zeit'
'weil ich habe drei Jahre Erfahrung'
'dass sie ist müde heute'
'dass er kann gut Deutsch'
'wenn ich habe Zeit, rufe ich Sie an'
'dass ich bin die richtige Person'
'dass ich bin sehr motiviert'
'weil ich muss jeden Tag arbeiten'
'damit ich bekomme eine Antwort'
'weil ich verdiene gut hier'
'dass ich bleibe lange im Team'
'weil ich bringe viel Erfahrung mit'
```

#### verb-final 守卫-否定（绝不可标记）
```
'weil ich keine Zeit habe'
'dass er gut Deutsch spricht'
'wenn Sie möchten, können wir morgen sprechen'
'dass das Team stark ist'
'dass ich die richtige Person bin'
'obwohl es schwierig war, habe ich nicht aufgegeben'
'weil ich arbeiten muss'
'dass ich gehen möchte'
'dass wir das schaffen können'
'dass er bald kommen wird'
'der gut Deutsch spricht, hilft mir'
'ob sie das wirklich verstehen'
'weil ich eine Antwort bekomme'
'weil ich hier gut verdiene'
'dass ich viel Erfahrung mitbringe'
'die mich wirklich fordert'
'dass ich mich hier wohlfühle'
```

#### article-gender 错误（必须捕获）
```
'ich habe die Problem gelöst'
'das war eine Problem für mich'
```

#### article-gender 守卫-否定（绝不可标记）
```
'ich habe das Problem gelöst'
'der Kunde war zufrieden mit der Lösung'
'ich arbeite gern im Team und lerne schnell'
'vielen Dank für das Gespräch'
```

### 3.2 瓶颈诊断准确性语料库（`server/scoring/bottleneckAccuracy.test.mjs`）

**零危害守卫:** 永不许命名错误瓶颈（误导向）+ 永不许从干净语音发明瓶颈（幻觉）。需要≥2次出现才命名模式。

#### 优势模式必须胜出
| 条件 | 预期瓶颈 |
|------|---------|
| 4×verb-final + 1×干净句 | `verb-final` |
| 2×verb-final | `verb-final` |
| 4×verb-final（含1×变种） | `verb-final` |
| 3×verb-final + 1×gender（verb-final主导） | `verb-final`（非gender） |
| 2×gender | `article-gender` |
| 1×gender + 1×verb-final（gender主导） | `article-gender`（非verb-final） |

#### 幻觉守卫
| 条件 | 预期 |
|------|------|
| 3句干净德语 | `null`（不命名瓶颈） |
| 1×verb-final + 1×干净句 | `null`（单次=意外） |
| 1×gender + 2×干净句 | `null` |
| 无语音 | `null` |

### 3.3 STT截断检测准确性语料库（`server/scoring/sttTrustAccuracy.test.mjs`）

**零危害:** 每个覆盖的截断片段必须被标记。漏标会导致学习者被错怪为系统bug。

#### 截断类（必须标记）
```
'Wir haben'
'Ich möchte gerne mit'
'und dann habe ich'
'Das war für'
'Ich denke, dass'
'weil'
'Meine'
'Wir haben.'
'Der Kunde hat'
```

#### 完整类（不可标记）
```
'Ja.', 'Gerne.', 'Natürlich.'
'Ich habe drei Jahre im Kundenservice gearbeitet.'
'Der Kunde war zufrieden mit der Lösung.'
'Ich arbeite gern im Team und lerne schnell.'
'Vielen Dank für das Gespräch.'
'Ich würde den Kunden zuerst beruhigen und dann eine Lösung anbieten.'
'Mein Name ist Omar und ich komme aus Kairo.'
'Das ist eine gute Frage, lassen Sie mich kurz überlegen.'
```

#### 已知差距（当前检测器未覆盖的截断）
```
'Ich wollte nur'  // 情态 + 副词尾随 — 记录在案，待夜间循环修复
```

### 3.4 录用就绪判定准确性语料库（`server/scoring/hireReadinessAccuracy.test.mjs`）

**零危害:** 永不许假录用（hireReady=true对不ready的候选人）+ 永不许假失败（hireReady=false对ready的候选人）

#### 明确可录用（永不可false-fail）
- B2级熟练（wpm 130, 低错误, 高结构, 良好冲突处理）
- B2级（wpm 125, 各方面均达标）
- C1级（wpm 140, 各方面优秀）
- B1门槛级（wpm 100, 刚好过每个门）

#### 明确不可录用（永不可false-hireable）- 每例恰好一项门不达标
- 语法强但发音不清晰（intelligibility 0.5 — STT猜太多）
- 更强语法但更差可懂度（intelligibility 0.4）
- 不能说客户下火（deescalation 0.3 — BPO关键技能缺失）
- 频繁卡壳放弃（giveUpRate 0.5）
- 太慢无法接听实时电话（wpm 55）
- 低水平高错误（wpm 70, errPer100 16）

#### 边缘案例（排除于零危害但用于ratchet）
- 语法弱但其他达标（errPer100 18）→ limit=grammar
- 无从句（subClauseRate 0.05）→ limit=complexity
- 高填充词+慢反应 → limit=confidence

### 3.5 流利度话题相关度测试（`server/fluencyDrill.test.mjs`）

| 测试 | 输入 | 预期 |
|------|------|------|
| 切题回答 | 提示=动机/敬业问题，回答提及motiviert/Faktoren/Arbeitsmoral | coverage > 0.3 |
| 词干容忍 | motiviert↔Motivation, Faktoren↔Faktor | 通过词干匹配 |
| 离题回答 | 关于海滩/天气的个人故事 | coverage < 0.15 |
| 诚实门 | "Ja, klar." / 无关键词提示 / 空输入 | coverage = null |

### 3.6 主题相关度停止词
以下提示中命令词/疑问词不计入主题覆盖（仅算脚手架，不算内容）：
`welche, welcher, welches, warum, wieso, weshalb, beschreiben, erzählen, schildern, nennen, erklären` 以及常见功能词
5字符以下的一般功能词也被排除。

---

## 4. 两个已部署修复的回归测试

### 修复1: 相同音频不可声称提升（Flow-Drill）

**部署于:** `server/fluencyDrill.js` + `client/src/FluencyDrill.jsx`

**问题:** 将同一份录音上传3次 → 应用声称"20%更快了"（转录时机差异造成WPM变化）

**服务端修复（`server/fluencyDrill.js`）：**
`/fluency/score` 端点通过 `POST body` 接收原始音频缓冲。在 `/fluency` GET 中，三个轮次共享同一个prompt，但客户端自行管理录音。

**客户端修复（`client/src/FluencyDrill.jsx`）：**
Debrief组件（第~280行起）在计算WPM变化时，显示的是"Dein Tempo blieb diesmal gleich oder ruhiger"且强调"KEIN Rückschritt"，当无改善时。但这还不够——相同音频仍能产生不同的转录时机，造成虚假的WPM变化。

**回归测试（`server/fluencyDrill.test.mjs`）：**
当前仅测试 `topicRelevancy()` 函数。**注意：** 相同音频守卫的完整回归测试在 Codex/Claude 的上一次会话中添加，位于 `.claude/worktrees/sag-fix/server/fluencyDrill.test.mjs`，内容为检查 `topicRelevancy()` 的确定性行为。

### 修复2: Sag es richtig 拒绝污染/矛盾的语音

**部署于:** `server/spokenReview.js`

**问题1 — 污染:** 正确目标短语嵌入长篇英文语音中 → 被标记为正确（仅因目标token存在）

**问题2 — 语义反转:** "Es tut mir nicht leid"（否定） → 被标记为正确（因为 "Es tut mir leid" 的token存在且否定词不影响token存在性检查）

**修复 (`gradeSpoken()` 函数)：**
1. **`isNearDuplicateOfWrong()` 守卫:** 如果转录与错误句子的编辑距离 ≤ 与正确句子的距离 → 拒绝
2. **模糊匹配永不接受实际错误token:** `fuzzyTokenMatch()` 的1编辑容错明确排除 `wrongSet` 中的token
3. **污染检测（Codex/Claude在sag-fix worktree中添加）：** 在转录中注入无关音频内容时，即使目标词组碰巧出现在转录中，也拒绝通过

**注意:** 在 Codex/Claude 的 sag-fix 会话中添加的 `server/spokenReviewContamination.test.mjs` 文件**不在当前工作区中**——它存在于 `.claude/worktrees/sag-fix/` worktree但从未合并回main。该测试的实质内容已合并到 `server/spokenReview.js` 的生产代码中，但独立的测试文件未随附。

---

## 5. 对抗测试用例（攻击面）

以下是针对每个功能设计的对抗用例，应用**应该拒绝**这些用例。

### 5.1 Shadowing 词准确率

| # | 攻击 | 预期行为 |
|---|------|---------|
| A1 | 只说出50%的目标词，其余换为无关词 | 准确率约50%，未命中词列表准确 |
| A2 | 说完全不同的一句话 | 准确率 0%，所有词均未命中 |
| A3 | 上传静音/噪音 | 服务端：有声 < 600ms → `{retry:true, noSpeech:true}` |
| A4 | 倒序说出所有目标词（词序混乱） | **漏洞:** 词准确率使用 `Set`（不检查顺序）→ 可能给 100% — 这是已知的设计缺陷 |
| A5 | 以阿拉伯语说出目标短语 | STT（语言=de）可能错误转录为德语乱码 → 结果不可预测 |

### 5.2 Sag es richtig 口语评分

| # | 攻击 | 预期行为 |
|---|------|---------|
| A6 | 在正确句子末尾添加否定（"Es tut mir leid, NICHT"） | **修复后:** `isNearDuplicateOfWrong()` 应拒绝 |
| A7 | 正确token位于大量无关英语中 | **修复后:** 应拒绝（需确认已部署） |
| A8 | 重新说出原始错误句（应将学习者推进而非归功） | **修复后:** `wrongSet` 排除实际错误token → `fuzzyTokenMatch` 不将其计为修复 |
| A9 | 说"Jahr"而非"Jahre"（原始错误=Jahr, 修正=Jahre, 1字符之差） | `wrongSet.has('jahr')` = true → 1-编辑容错不适用 → 应为错误 |
| A10 | 上传空白/近乎空白的录音 | `voicedDurationMs` < 600 → `{retry:true, noSpeech:true}` |
| A11 | 单次编辑差异但结果恰是错误token（"den"代替"dem"） | 如果 wrongSet 包含 "den" → 不通过；否则 应标记正确 |
| A12 | 目标词出现但有额外矛盾内容（"Das ist Ihr Problem" 而提示是 "Es tut mir leid"） | **当前行为:** 如果required token存在但无关前缀 → `isNearDuplicateOfWrong()` 守卫应拒绝 |

### 5.3 Flow-Drill（4-3-2）

| # | 攻击 | 预期行为 |
|---|------|---------|
| A13 | 完全相同音频 ×3 | **修复后:** 不应声称20%提升 →
| A14 | 话题A的音频，但提问了话题B | 话题相关度应显示低覆盖（词重叠少） |
| A15 | 60秒录音但只有5秒实际语音 | `voicedDurationMs` 为WPM计算基础 → WPM应基于5秒语音而非60秒 |
| A16 | 在WPM中插入30个"äh ähm ähm" | 填充词计数上升，但WPM（词/有声分钟）可能因额外词而上升 — 可能被滥用 |
| A17 | 上传非德语语音（阿拉伯语/英语） | STT输出乱码 → `topicRelevancy` 覆盖率低；流利度数字无意义 |
| A18 | 无真正有声的录音 | 服务端：有声 < 600ms → `{retry:true, noSpeech:true}` |

### 5.4 Blitz-Formeln

| # | 攻击 | 预期行为 |
|---|------|---------|
| A19 | 以混乱顺序说出公式 — "mir leid wirklich das tut" | `chunkMatch` 要求顺序 → 应失败（比例低） |
| A20 | 说出公式但延迟3000ms+ | 命中=正确但判定=slow |
| A21 | 说出公式但延迟<1500ms | 命中=正确且判定=automatic |

### 5.5 L1错误检测

| # | 攻击 | 预期行为 |
|---|------|---------|
| A22 | "weil ich arbeiten muss" | **不应标记为verb-final** — MODAL_AUX_FINAL守卫 |
| A23 | "weil ich gehen möchte" | 同上 |
| A24 | "der Frage"（正确的与格） | **不应标记为article-gender** — feminine + der在与格中是合法的 |
| A25 | "die Problem"（错误冠词 ×2） | 应标记为article-gender（每句1次，2次出现 = 模式） |
| A26 | "gegen"不实词（以ge-开头的非过分词） | 不应被 `structureWins` 误计为过分词 |
| A27 | "das war mit Python. Wir haben"（截断回合） | 不应被引用到瓶颈输出中 |

### 5.6 录用就绪

| # | 攻击 | 预期行为 |
|---|------|---------|
| A28 | wpm=130, errPer100=3, 各方面优秀但intelligibility=0.5 | hireReady=false（STT可信度门不达标）|
| A29 | 所有指标刚好过门 | hireReady=true（审查每个门的阈值） |
| A30 | wpm=89, 其他完美 | hireReady=false（仅wpm门不达标） |

---

## 6. 已知缺陷与未实现功能

### 6.1 从上次浏览器语音运行得出的状态（2026-07-17）

| 功能 | 状态 | 局限性 |
|------|------|--------|
| 正确词检测 | **部分可用** | 转录级别，非声学级别 |
| 完全错误回答拒绝 | **可用**（已测试的案例） | 需审查更多对抗案例 |
| 仅正确才通过 | **不可靠** | 污染/部分匹配仍可能通过 |
| 细微发音偏差检测 | **不可用** | 需要声学分析；系统无法做此事 |
| 精确发音纠正 | **不可用** | 同上 |
| Flow改善测量 | **近期修复** | 相同音频守卫已添加，置信区间未显示 |

### 6.2 评估数据缺口（来自 `docs/eval-data-audit-2026-07-15.md`）

- **S1**（口音ASR鲁棒性）: 无可用的独立基准 — Common Voice是朗读短句，不是即兴面试
- **S2**（语法错误检测）: MERLIN v1.2可做书面文本的（无音频）基准
- **S3**（CEFR/水平信号）: 同上
- **S4**（流利度指标）: 无公开基准 — 仅有确定性代码正确性
- **S5**（瓶颈诊断）: 无公开数据 — 仅金标研究可验证
- **S6**（改善验证）: 无公开数据 — 需纵向配对重测
- **埃及阿拉伯语-L1:** 无公开语料库 — 现有的唯一物品是25名受试者的叙利亚语音研究

### 6.3 发音检测 — 为何完全不可用

服务器 **从未听到**真实音频——它只看到转录文本：
```
音频 → Groq Whisper → 文本（"Ich habe eine Frage"）
声学信号（音素、口音、韵律）→ 丢失 ↑
```

因此任何声称发音检测的说法都是虚构的。需要实现：
1. 强制对齐（德语音素序列 vs 实际音频）
2. 专家验证的类别（元音长度、/ç/ vs /x/、辅音群、重音）
3. 冻结评估集 + 双盲人类评分者
4. 每类别的精度门（≥95%）后才能上线

---

## 7. 运行测试命令

### 全部测试套件
```powershell
cd C:\Users\lenovo\OneDrive\Desktop\bpo-combat-arena
cd server
npx node --test scoring/grammarAccuracy.test.mjs
npx node --test scoring/bottleneckAccuracy.test.mjs
npx node --test scoring/sttTrustAccuracy.test.mjs
npx node --test scoring/hireReadinessAccuracy.test.mjs
npx node --test scoring/l1Errors.test.mjs
npx node --test scoring/structureWins.test.mjs
npx node --test scoring/turnQuality.test.mjs
npx node --test fluencyDrill.test.mjs
npx node --test chunkAutomaticity.test.mjs
npx node --test langGuard.test.mjs
npx node --test transcriptGuard.test.mjs
```

### 一键运行全部评分测试
```powershell
cd C:\Users\lenovo\OneDrive\Desktop\bpo-combat-arena\server
Get-ChildItem -Recurse -Include "*.test.mjs" -Path "scoring" | ForEach-Object { npx node --test $_.FullName }
```

### 生产构建
```powershell
cd C:\Users\lenovo\OneDrive\Desktop\bpo-combat-arena\client
npx vite build
```

### 服务端启动
```powershell
cd C:\Users\lenovo\OneDrive\Desktop\bpo-combat-arena\server
npx node server.js
```

或如果开发模式：
```powershell
cd C:\Users\lenovo\OneDrive\Desktop\bpo-combat-arena
npm run dev
```

---

## 8. 评估框架（外部数据 + 金标研究）

### 立即可用的零成本基准

**MERLIN v1.2**（Eurac Research CLARIN，CC BY-SA 4.0）:
- 1035篇德语学习者书面文本
- A1-C2 CEFR标注（双评分者 + Rasch校准）
- 错误标注 + FALKO风格目标假设
- **零audio** — 仅能评论S2（语法错误检测）和S3（CEFR信号）

获取: `gitlab.inf.unibz.it/commul/merlin-platform/data-bundle` tag v1.2

**许可陷阱:** CC BY-SA的ShareAlike子句在再分发改编材料时触发。**永不要提交MERLIN数据到仓库。**

### 不可用（已检查并拒绝）

| 数据集 | 拒绝原因 |
|--------|---------|
| DGD/FOLK | 非商业科学用途限制 |
| GeWiss | 非商业用途，需运营者书面许可 |
| Common Voice DE | 朗读短句（5秒片段）≠即兴面试 |
| Syrian Arabic-L1 | N=25、诱发朗读、语音学焦点 |
| Goethe/telc/ÖSD 样本 | **未验证线索** — 最有希望的公开口语途径但从未抓取 |

### 金标研究的必要性

公开数据可以硬化S2+S3（书面）—— 仅此而已。除此之外的一切：
- S1（口音ASR）
- S4（流利度效度）
- S5（瓶颈诊断准确性）
- S6（改善验证）
- 任何关于埃及阿拉伯语-L1说话者的断言

**只能**通过金标研究来证明：20-30名征得同意的埃及学习者、双盲评分者、配对重测、锁定保留集。

---

## 附录A：当前提交日志（截至2026-07-17）

```
79feb88 Salma retone: balanced professional recruiter, not salesy (owner-approved)
e22cd71 Fix DailyTraining "load another round" crash
8c87d01 PressureLadder: stop advertising the removed survival mode
af85747 Salma speaks masri: fill 25 cold-open ar slots
6f929d0 Boss avatar: reactive voice-presence ring
...
```

最近的MERGED修复（Codex/Claude制作的2个）**不在独立提交中**——它们被编辑到现有文件中并合并。主要更改：
- `server/spokenReview.js`: 添加 `isNearDuplicateOfWrong()` 守卫, 每秒率限制, 污染/矛盾检测
- `client/src/FluencyDrill.jsx`: 相同音频无改善声称
- `server/fluencyDrill.js`: 相同音频守卫逻辑

## 附录B：提供给Codex/Claude的原始会话上下文

上一次会话在浏览器中以可听方式运行了以下测试：
1. **Shadowing:** 干净音频因扬声器到麦克风循环失真被以0%拒绝
2. **Shadowing:** "reise" vs "reiche" — 检测到词差异但无法验证发音
3. **Sag es richtig:** 正确句子被接受（含英文污染）
4. **Sag es richtig:** "Es tut mir nicht leid… Das ist Ihr Problem" 被正确拒绝
5. **Flow:** 相同录音×3显示虚假改善230→241→277 WPM
6. 会后修复 → `0c6f8fa`（可能引用不同的仓库或分支）
7. 生产验证: 被污染的Sag es richtig被拒绝, Flow相同音频无改善声明

---

*此文档涵盖所有6个语音功能的完整评估面。将本文件交给任何外部AI用于独立测试。需要澄清任何具体功能时，参考上述文件映射。*
