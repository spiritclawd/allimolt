const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, 
        AlignmentType, PageNumber, BorderStyle, WidthType, ShadingType, VerticalAlign, 
        HeadingLevel, LevelFormat, TableOfContents, PageBreak } = require('docx');
const fs = require('fs');

// Color scheme - "Midnight Code" for tech/AI venture
const colors = {
  primary: "020617",     // Midnight Black
  body: "1E293B",        // Deep Slate Blue  
  secondary: "64748B",   // Cool Blue-Gray
  accent: "94A3B8",      // Steady Silver
  tableBg: "F8FAFC",     // Glacial Blue-White
  headerBg: "E2E8F0"     // Light slate
};

const tableBorder = { style: BorderStyle.SINGLE, size: 8, color: colors.accent };
const cellBorders = { top: tableBorder, bottom: tableBorder, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Times New Roman", size: 22 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal",
        run: { size: 56, bold: true, color: colors.primary, font: "Times New Roman" },
        paragraph: { spacing: { before: 0, after: 200 }, alignment: AlignmentType.CENTER } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, color: colors.primary, font: "Times New Roman" },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, color: colors.body, font: "Times New Roman" },
        paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, color: colors.secondary, font: "Times New Roman" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } }
    ]
  },
  numbering: {
    config: [
      { reference: "bullet-list",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbered-1",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbered-2",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbered-3",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbered-4",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbered-5",
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }
    ]
  },
  sections: [{
    properties: {
      page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
    },
    headers: {
      default: new Header({ children: [new Paragraph({ 
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "AlliGo Competitive Analysis | Confidential", size: 18, color: colors.secondary })]
      })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ 
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Page ", size: 18, color: colors.secondary }),
          new TextRun({ children: [PageNumber.CURRENT], size: 18, color: colors.secondary }),
          new TextRun({ text: " of ", size: 18, color: colors.secondary }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: colors.secondary })
        ]
      })] })
    },
    children: [
      // Title
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("AlliGo Competitive Analysis")] }),
      new Paragraph({ 
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [new TextRun({ text: "The Credit Bureau for AI Agents - Strategic Differentiation & Market Position", size: 22, italics: true, color: colors.secondary })]
      }),
      new Paragraph({ 
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
        children: [new TextRun({ text: "June 2025", size: 20, color: colors.accent })]
      }),

      // Executive Summary
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Executive Summary")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "AlliGo occupies a unique and defensible position in the emerging AI agent trust ecosystem. While competitors like Armilla focus on insurance products and Daydreams/ERC-8004 handle identity infrastructure, AlliGo is building the critical missing layer: the actual behavioral and forensic data that makes risk assessment possible. This analysis identifies strategic gaps, differentiation opportunities, and the specific data moats that competitors are overlooking.", size: 22 })]
      }),

      // Key Findings Table
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Key Strategic Findings")] }),
      new Table({
        columnWidths: [3000, 6360],
        margins: { top: 100, bottom: 100, left: 150, right: 150 },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              new TableCell({
                borders: cellBorders,
                width: { size: 3000, type: WidthType.DXA },
                shading: { fill: colors.headerBg, type: ShadingType.CLEAR },
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Dimension", bold: true, size: 22 })] })]
              }),
              new TableCell({
                borders: cellBorders,
                width: { size: 6360, type: WidthType.DXA },
                shading: { fill: colors.headerBg, type: ShadingType.CLEAR },
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Strategic Insight", bold: true, size: 22 })] })]
              })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Data Gap", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 6360, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "No competitor has systematic agent failure data. Everyone tracks identity (ERC-8004) or sells insurance (Armilla), but nobody aggregates the behavioral signals that predict failures.", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Competitor Blindspot", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 6360, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Armilla and insurers need data they don't have. ERC-8004 provides identity but not reputation history. This creates a natural partnership opportunity.", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Unique Moat", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 6360, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Agent behavioral forensics - transaction patterns, failure signatures, exploit mimicry detection, counterparty guilt analysis. This data compound over time.", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 3000, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Investor Thesis", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 6360, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "First-mover in the data layer that enables the entire AI insurance industry. Similar to how credit bureaus became essential infrastructure for lending.", size: 22 })] })] })
            ]
          })
        ]
      }),
      new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Table 1: Strategic Positioning Summary", size: 18, italics: true, color: colors.secondary })] }),

      // Section 1: Competitive Landscape
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("1. Competitive Landscape Analysis")] }),
      
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("1.1 Direct and Adjacent Competitors")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "The AI agent trust ecosystem has several emerging players, each approaching the problem from different angles. Understanding their positioning reveals significant gaps that AlliGo can exploit:", size: 22 })]
      }),

      // Armilla Analysis
      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("Armilla AI - Insurance Provider")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "What they do: Armilla is the world's first MGA (Managing General Agent) focused solely on AI insurance. They offer third-party testing, compliance verification, and warranty coverage for AI systems. Their Lloyd's-backed coverage recently expanded to $25M, targeting generative AI and AI agent deployments.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Their limitation: Armilla verifies AI systems before deployment and provides insurance coverage, but they lack ongoing behavioral data collection. Their underwriting relies on point-in-time assessments rather than continuous agent activity monitoring. This creates a data gap that affects pricing accuracy and risk prediction.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Why they need AlliGo: Armilla's insurance products require historical loss data, behavioral patterns, and failure rates that don't exist in systematic form. AlliGo's forensic data could dramatically improve their underwriting accuracy and enable real-time risk monitoring products.", size: 22 })] }),

      // ERC-8004 / Daydreams Analysis
      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("ERC-8004 / Daydreams - Identity Infrastructure")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "What they do: ERC-8004 is Ethereum's identity standard for AI agents, providing on-chain registries for identity, reputation, and validation. Daydreams (Lucid Agents) builds commerce SDKs with native support for x402 payments and ERC-8004 identity. They enable agents to discover each other, transact, and build verifiable trust signals.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Their limitation: ERC-8004 provides the 'ID card' for agents but doesn't track behavioral history. Reputation scores are self-reported or based on limited validation events. They don't capture transaction failures, exploit patterns, or loss history. Identity without behavioral data is insufficient for risk assessment.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Integration opportunity: AlliGo's forensic scores could become a key reputation signal in ERC-8004 registries. Imagine an agent's on-chain identity showing 'AlliGo Risk Score: 85/100 - 0 claims - 90 days monitored' alongside their other credentials.", size: 22 })] }),

      // Platform Players
      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("Platform Players - ElizaOS, Virtuals Protocol")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "ElizaOS: A modular TypeScript framework for autonomous AI agents that can trade, interact socially, and execute financial strategies. Recent research exposed security vulnerabilities including context manipulation attacks. These agents need trust verification but platforms don't provide it.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Virtuals Protocol: Tokenizes AI agents as co-owned assets on-chain. A recent incident saw an AI agent steal $500K from the protocol, highlighting the need for behavioral monitoring. Non-verified agents were filtered out afterward - exactly the kind of screening AlliGo could provide proactively.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "The gap: Platforms focus on agent creation and monetization, not trust verification. They need third-party risk scores to protect users, but no provider offers systematic behavioral analysis. This creates a B2B API opportunity for AlliGo.", size: 22 })] }),

      // Section 2: What We're Missing
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("2. What We're Missing - Honest Assessment")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "While AlliGo has a strong theoretical position, several gaps need immediate attention to capitalize on our competitive advantage:", size: 22 })]
      }),

      // Critical Gaps
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("2.1 Critical Gaps (Blocks Revenue)")] }),
      new Paragraph({ numbering: { reference: "numbered-1", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Payment Processing: While x402 code exists, the Stripe integration for traditional payments is incomplete. Users cannot currently upgrade from free tier, blocking all revenue generation. The 'unlock for $1 USDC' flow needs to clearly explain x402 protocol usage, not redirect to package offers.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-1", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "User Authentication: No signup/login system exists. Without user accounts, we cannot track API usage, generate per-user keys, or build customer relationships. Authentication is prerequisite for any subscription model.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-1", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Lead Capture: The landing page lacks email capture mechanisms. Visitors leave without converting, losing potential customers and investors. A waitlist for Pro tier would build demand signals.", size: 22 })] }),

      // Strategic Gaps
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("2.2 Strategic Gaps (Blocks Growth)")] }),
      new Paragraph({ numbering: { reference: "numbered-2", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Data Volume: Current database has limited claims. The data moat is thin - competitors could catch up if we don't scale ingestion rapidly. Need automated daily ingestion from multiple sources plus user-submitted claims.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-2", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Platform Integrations: None deployed yet. The Eliza plugin exists in code but isn't published. Virtuals integration is planned but not implemented. Platform distribution is critical for growth.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-2", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Insurance Partnerships: No formal partnerships with insurers. This represents $50K-$500K/year per partnership in potential revenue. Cold outreach to Armilla, Nexus Mutual, and DeFi insurance protocols should begin immediately.", size: 22 })] }),

      // Section 3: Why Investors Choose Us
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("3. Why Investors Would Choose AlliGo")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "The investment thesis for AlliGo centers on becoming essential infrastructure for the AI agent economy. Here's why investors would choose us over competitors:", size: 22 })]
      }),

      // Investment Thesis Table
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("3.1 Investment Thesis")] }),
      new Table({
        columnWidths: [2500, 3430, 3430],
        margins: { top: 100, bottom: 100, left: 150, right: 150 },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              new TableCell({ borders: cellBorders, width: { size: 2500, type: WidthType.DXA }, shading: { fill: colors.headerBg, type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Factor", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, shading: { fill: colors.headerBg, type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "AlliGo Advantage", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, shading: { fill: colors.headerBg, type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Competitor Weakness", bold: true, size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 2500, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Data Moat", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Behavioral forensics compound over time; each agent monitored adds to predictive models", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Armilla has point-in-time assessments; ERC-8004 has identity without history", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 2500, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Network Effect", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "More agents scored = better data = more accurate scores = more users", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Platforms like Virtuals have network effects around creation, not trust", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 2500, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Market Timing", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "AI agent economy exploding; losses accelerating; insurers entering market", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Traditional insurers retreating from AI risk; gaps in coverage", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 2500, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Revenue Model", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Multiple streams: API subscriptions, data licensing, insurance partnerships, certification", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Competitors have single revenue streams (insurance premiums or platform fees)", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 2500, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Acquisition Path", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Natural acquisition target for insurers needing AI risk data (like Riskified's $4.5B exit to Visa)", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 3430, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Armilla could be acquirer; ERC-8004 is a standard, not a company", size: 22 })] })] })
            ]
          })
        ]
      }),
      new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Table 2: Competitive Advantage Matrix", size: 18, italics: true, color: colors.secondary })] }),

      // Section 4: What Data Are People Passing By
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("4. What Data Competitors Are Passing By")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "The most significant competitive gap is the data that no one is systematically collecting. This represents AlliGo's primary opportunity:", size: 22 })]
      }),

      // Data Categories
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("4.1 Behavioral Forensic Data (Untapped)")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Transaction Failure Patterns: When agents execute trades or financial operations, failures leave signatures. Slippage errors, out-of-gas failures, front-running losses, and revert patterns indicate skill levels and risk profiles. No one aggregates these across agents.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Exploit Mimicry Detection: Malicious agents often copy successful exploit patterns. By analyzing transaction sequences, we can detect when an agent's behavior matches known attack signatures - before losses occur. This is predictive, not reactive.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Loss Acceleration Patterns: Agents that start losing often increase risk-taking behavior (similar to gambler's fallacy). Tracking loss streaks and response patterns provides early warning signals that traditional metrics miss.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Counterparty Guilt by Association: When an agent interacts with flagged addresses or exploited protocols, their risk score should reflect this association. Current solutions don't track these indirect connections.", size: 22 })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("4.2 On-Chain Activity Data (Underutilized)")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Protocol Risk Exposure: Agents interact with various DeFi protocols with different risk profiles. Tracking which protocols an agent uses, their exposure levels, and how quickly they respond to protocol issues provides risk signals.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Leverage Spike Detection: Sudden increases in leverage ratio often precede liquidation events. Monitoring leverage changes across time provides early warning. Current identity solutions don't track this.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Abandonment Signals: Agents that reduce activity, withdraw funds, or change behavior patterns may be preparing to exit or have been compromised. These signals are invisible to point-in-time assessments.", size: 22 })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("4.3 Platform-Specific Data (Ignored)")] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "ElizaOS Security Events: The framework has known vulnerabilities (context manipulation attacks, prompt injection). Agents built on ElizaOS have specific risk profiles that should be tracked. No one is doing this systematically.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Virtuals Token Performance: Each agent on Virtuals has a token with price history. Token performance correlates with agent reliability. This data is public but not aggregated into trust scores.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "bullet-list", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Cross-Platform Identity Resolution: The same agent may operate across multiple platforms under different identities. Linking these identities provides a more complete risk picture. ERC-8004 provides identity but doesn't track cross-platform behavior.", size: 22 })] }),

      // Section 5: Differentiation Strategy
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("5. Strategic Differentiation - Focus Areas")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "Based on competitive analysis, AlliGo should focus on these areas where competitors have blindspots:", size: 22 })]
      }),

      // Focus Areas
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.1 Agentic Data vs. User/Wallet Data")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "Current solutions focus on either user identity (KYC) or wallet analysis (blockchain forensics). Neither captures the unique characteristics of AI agents:", size: 22 })]
      }),
      new Paragraph({ numbering: { reference: "numbered-3", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Agent Behavioral Archetypes: Unlike humans, agents have predictable behavioral patterns that can be classified. 'Exploit Mimicry', 'Loss Acceleration', 'Profit Harvesting', 'Rookie Mistake' - these archetypes have specific signatures. AlliGo's pattern engine detects these.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-3", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Autonomous Decision Patterns: Agents make decisions without human oversight, often following programmed strategies. When these strategies fail or behave unexpectedly, it reveals information about the agent's design quality and risk exposure.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-3", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Agent-to-Agent Interactions: The emerging agent economy involves agents transacting with other agents. These interaction patterns reveal trust networks and risk propagation pathways that human-focused analysis misses.", size: 22 })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.2 Predictive vs. Reactive Risk Assessment")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "Armilla verifies before deployment; insurers pay after losses. AlliGo provides continuous monitoring with predictive alerts:", size: 22 })]
      }),
      new Paragraph({ numbering: { reference: "numbered-4", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Real-Time Risk Scores: As agents transact, their risk scores update. A sudden drop can trigger alerts to insurers, platforms, or users before major losses occur.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-4", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Recurrence Forecasting: Based on detected patterns, AlliGo can predict the likelihood of future failures. 'This agent has 73% probability of significant loss within 30 days based on loss acceleration pattern.'", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-4", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Dynamic Premium Pricing: Insurance partners can adjust coverage pricing based on real-time risk signals, creating a responsive market for AI risk.", size: 22 })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.3 Open Data Layer vs. Closed Platforms")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "AlliGo's positioning as the 'data layer' for AI agent trust creates network effects that closed platforms cannot match:", size: 22 })]
      }),
      new Paragraph({ numbering: { reference: "numbered-5", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "API-First Approach: Any platform can integrate AlliGo scores. ElizaOS, Virtuals, custom agent deployments - all benefit from standardized risk assessment.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-5", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Neutral Data Provider: Unlike platforms with vested interests, AlliGo is neutral. We aggregate and score; we don't compete with agent creators or platforms.", size: 22 })] }),
      new Paragraph({ numbering: { reference: "numbered-5", level: 0 }, spacing: { line: 312 }, children: [new TextRun({ text: "Community-Verified Claims: Open submission of agent failures with evidence creates a crowdsourced verification system that improves data quality over time.", size: 22 })] }),

      // Section 6: Action Items
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("6. Immediate Action Items")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "To capitalize on these competitive advantages, immediate focus should be on:", size: 22 })]
      }),

      // Priority Matrix
      new Table({
        columnWidths: [1500, 4000, 2000, 1860],
        margins: { top: 100, bottom: 100, left: 150, right: 150 },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              new TableCell({ borders: cellBorders, width: { size: 1500, type: WidthType.DXA }, shading: { fill: colors.headerBg, type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Priority", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 4000, type: WidthType.DXA }, shading: { fill: colors.headerBg, type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Action", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 2000, type: WidthType.DXA }, shading: { fill: colors.headerBg, type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Impact", bold: true, size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 1860, type: WidthType.DXA }, shading: { fill: colors.headerBg, type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Timeline", bold: true, size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "P0", bold: true, color: "DC2626", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 4000, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Fix 'Unlock for $1' flow to show x402 instructions", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Unlocks Revenue", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 1860, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "1 day", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "P0", bold: true, color: "DC2626", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 4000, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Add user authentication and API key management", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Enables Billing", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 1860, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "2-3 days", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "P1", bold: true, color: "EA580C", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 4000, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Scale data ingestion from agentic platforms", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Data Moat", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 1860, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "1 week", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "P1", bold: true, color: "EA580C", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 4000, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Publish ElizaOS plugin to npm", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Distribution", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 1860, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "1 day", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "P1", bold: true, color: "EA580C", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 4000, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "Outreach to Armilla for partnership discussion", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Revenue Path", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 1860, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Ongoing", size: 22 })] })] })
            ]
          }),
          new TableRow({
            children: [
              new TableCell({ borders: cellBorders, width: { size: 1500, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "P2", bold: true, color: "CA8A04", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 4000, type: WidthType.DXA }, children: [new Paragraph({ spacing: { line: 312 }, children: [new TextRun({ text: "ERC-8004 reputation signal integration", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Ecosystem", size: 22 })] })] }),
              new TableCell({ borders: cellBorders, width: { size: 1860, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "2 weeks", size: 22 })] })] })
            ]
          })
        ]
      }),
      new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Table 3: Action Priority Matrix", size: 18, italics: true, color: colors.secondary })] }),

      // Conclusion
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("7. Conclusion")] }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "AlliGo's competitive position is stronger than it appears. While Armilla has insurance distribution and ERC-8004 has identity infrastructure, neither has the behavioral data layer that makes risk assessment possible. The question isn't whether AlliGo can compete - it's whether we can execute fast enough to establish the data moat before competitors recognize the gap.", size: 22 })]
      }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "The key insight is that we're not competing with Armilla or Daydreams - we're building the layer they both need. Armilla needs our data for better underwriting; ERC-8004 needs our scores for meaningful reputation signals. Our strategy should be partnership-first, positioning AlliGo as essential infrastructure for the entire AI agent trust ecosystem.", size: 22 })]
      }),
      new Paragraph({ 
        spacing: { after: 200, line: 312 },
        children: [new TextRun({ text: "Immediate focus: Fix revenue blockers, scale data ingestion, and begin partnership conversations. The window to establish the data moat is open now.", size: 22 })]
      })
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/home/z/my-project/download/allimolt/docs/COMPETITIVE_ANALYSIS.docx", buffer);
  console.log("Document created successfully!");
});
