# TradeGuardian - Production Plan

## Overview
Build a production-grade SaaS web application called "TradeGuardian" — an AI-powered behavioral risk management and discipline enforcement platform for retail traders.

**Core Mission**: Prevent traders from blowing up their accounts through automated discipline and behavioral risk controls.

---

## CORE PRODUCT IDEA

The platform acts as a behavioral operating system for traders.

It should:
- Monitor trading behavior
- Enforce risk limits
- Detect emotional trading patterns
- Automatically intervene when trader behavior becomes dangerous
- Help traders build discipline and consistency

The app should feel modern, premium, fast, and psychologically calming.

**Design Inspiration**:
- Zerodha Kite
- Linear
- Stripe Dashboard
- Notion
- TradingView
- Modern fintech SaaS

**UI Requirements**:
- Dark/light mode
- Smooth animations
- Clean typography
- Responsive design
- Modern SaaS UI

---

## TECH STACK

### Frontend
- Next.js
- React
- TypeScript
- TailwindCSS
- shadcn/ui

### Backend
- Node.js
- Express or Next.js API routes

### Database
- PostgreSQL

### ORM
- Prisma

### Authentication
- JWT + secure cookies
- OAuth-ready architecture

### Realtime
- WebSockets

### Deployment
- Frontend deployable to Vercel
- Backend deployable to Railway/Render/Fly.io

Architecture must be production-grade and modular.

---

## BROKER INTEGRATION

### Initial Integration
- Zerodha Kite Connect

### Future Integrations (Adapter Pattern)
- Upstox
- Angel One
- Dhan
- Fyers
- Interactive Brokers

Broker integrations should use adapter pattern.

---

## CORE FEATURES

### 1. DAILY LOSS LIMIT

**User Configuration**:
- Max daily loss amount

**Actions on Breach**:
- Trigger kill state
- Cancel all pending orders
- Square off all open positions
- Monitor for new positions
- Auto-exit any new position opened after kill state

Kill state remains active until next trading day.

### 2. TRADE COUNT LIMIT

**User Configuration**:
- Max trades per day

**Actions on Exceed**:
- Block further trading
- Auto-exit new positions

### 3. CONSECUTIVE LOSS LOCK

**Example Configuration**:
- After 3 consecutive losses
- Disable trading for 30 mins

**Requirements**:
- Cooldown timer UI

### 4. POSITION SIZE LIMIT

**Detection**:
- Unusually large positions
- Sudden increase in risk

**Example Rule**:
- Position size 3x average size

**Warning Message**:
"Your current position size is significantly larger than your historical average."

### 5. REVENGE TRADING DETECTION

**Patterns to Detect**:
- Rapid trading after losses
- Increased size after losses
- High frequency trading after drawdown

**Actions**:
- Show intervention popup
- Optionally enforce cooldown

### 6. PROFIT PROTECTION MODE

**User Configuration**:
"If profit reaches X, stop trading after losing Y from peak."

**Example**:
+20k profit → loses 5k → trading disabled

### 7. DISCIPLINE SCORE

**Generate**: Discipline Score (0-100)

**Metrics**:
- Risk rule adherence
- Overtrading
- Revenge trading
- Consistency
- Emotional behavior
- Trade timing
- Drawdown control

**Display**:
- Score trends
- Weekly analytics
- Monthly analytics

### 8. TRADER DNA / BEHAVIOR PROFILE

**Analyze trading history and generate insights**:
"You tend to revenge trade after 2 consecutive losses."
"You become more aggressive after profitable days."
"You overtrade near market close."

**Features**:
- Behavioral profile dashboard
- Emotional pattern analytics

### 9. AI RISK COACH

**AI-generated coaching insights**:
"Your behavior today resembles previous high-loss sessions."
"You are trading 3x more frequently than normal."
"You are deviating from your typical risk profile."

**Focus**: Psychology and discipline, NOT trade predictions.

### 10. TRADING JOURNAL

**Built-in journal system**:
- Trade notes
- Screenshots
- Emotional state
- Mistakes
- Lessons

**AI Analysis**: Pattern detection in journal entries.

### 11. TELEGRAM / WHATSAPP ALERTS

**Alert Types**:
- Kill switch activation
- Warnings
- Cooldown triggers
- Discipline alerts
- Abnormal trading behavior

### 12. ANALYTICS DASHBOARD

**Advanced Dashboards**:
- P&L analytics
- Behavioral analytics
- Discipline trends
- Streaks
- Risk heatmaps
- Consistency charts
- Trading hour analysis
- Win/loss patterns

### 13. GAMIFICATION

**Features**:
- Discipline streaks
- Consistency badges
- Emotional control achievements
- Leaderboard (optional)

### 14. REALTIME ENGINE

**Technology**:
- WebSockets
- Realtime updates
- Realtime P&L
- Realtime risk monitoring

**Requirement**: Instant response system.

### 15. SECURITY

**Production-grade requirements**:
- Encrypted secrets
- Secure token storage
- Backend-only broker auth
- No API secret in frontend
- Rate limiting
- CSRF protection
- XSS protection

### 16. DATABASE DESIGN

**Scalable schemas for**:
- Users
- Broker accounts
- Trades
- Positions
- Behavioral events
- Discipline scores
- Alerts
- Journals
- Risk settings
- Analytics snapshots

### 17. SAAS FEATURES

**Include**:
- Subscription plans
- Stripe integration
- Onboarding flow
- User settings
- Admin dashboard
- Feature flags
- Audit logs

### 18. LANDING PAGE

**Premium landing page focusing on**:
- Discipline
- Survival
- Behavioral control
- Risk management

**NOT**: Signals or guaranteed profits

**Suggested Messaging**:
"Stop blowing trading accounts."
"Trading discipline should be automated."
"Your strategy fails without risk control."

### 19. DESIGN REQUIREMENTS

**Design should feel**:
- Premium
- Modern fintech
- Emotionally calming
- Trustworthy

**UI Elements**:
- Glassmorphism subtly
- Smooth transitions
- Animated charts
- Clean cards
- Responsive layouts

### 20. ARCHITECTURE REQUIREMENTS

**Codebase must be**:
- Modular
- Production-ready
- Scalable
- Maintainable
- Properly typed
- Cleanly structured

**Patterns to use**:
- Service layer
- Repository pattern
- Broker abstraction layer
- Reusable UI components
- Centralized risk engine

---

## BUILD ORDER

### Phase 1
- Auth
- Dashboard
- Kite integration
- Daily loss limit
- Square-off logic

### Phase 2
- Trade count limits
- Cooldowns
- Alerts
- Analytics

### Phase 3
- Behavioral engine
- Discipline scoring
- AI coaching

### Phase 4
- SaaS billing
- Multi-broker support
- Mobile app support

---

## DELIVERABLES TO GENERATE

- Full project architecture
- Folder structure
- Database schema
- Backend APIs
- Frontend pages
- Reusable components
- Risk engine services
- WebSocket architecture
- Deployment instructions

**Code Quality**: Write clean production-quality code. Avoid mock/demo-only implementations.
