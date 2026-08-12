
# Project TODO

- [x] Implement dark-space mobile-first PWA shell with fixed balance header and bottom navigation labeled Rewards, Wallet, Me
- [x] Add server-authoritative points ledger with earn, spend, transfer, and audit trail records
- [x] Add data-driven offer providers and Rewards offerwall bottom-sheet with iframe/external-link behavior
- [x] Add daily tasks/missions with server-side claim validation and one-time bonus protection
- [x] Add Wallet balance, transaction history, and minimum-threshold cash-out flow
- [x] Add Me profile, avatar, earned/withdrawn stats, settings, referral link, and logout
- [x] Add referral attribution and award bonus only after referred user completes first task
- [x] Add role-gated admin dashboard for users, platform stats, and withdrawal review actions
- [x] Add manifest, service worker offline shell, and installable PWA prompt
- [x] Add responsive motion, drawer transitions, button press feedback, and reduced-motion support
- [x] Add Vitest coverage for ledger, task claims, referral bonus, withdrawal threshold, and admin authorization
- [x] Run typecheck, tests, production build, and mobile/desktop visual verification
- [x] Make the app shell fixed and persistent with a live balance header and nav
- [x] Implement real spend and transfer procedures with comprehensive audit logging
- [x] Embed provider offerwalls in the bottom sheet with loading and error states
- [x] Replace hardcoded profile stats and referral link with server-backed data
- [x] Implement referral attribution persistence on signup and first-task award flow
- [x] Add admin user-management views/actions
- [x] Add install prompt flow and valid manifest icons
- [x] Expand tests for ledger, duplicate task claims, and referral awarding
- [x] Harden spend and transfer mutations to require the database and transaction semantics in production paths
- [x] Add explicit offerwall iframe loading and error state UI
- [x] Add live profile stats and eliminate remaining hardcoded referral links
- [x] Wire referral attribution into onboarding with stable per-user codes
- [x] Add admin user management actions beyond listing
- [x] Add focused tests for ledger writes, duplicate task claims, and referral award timing

- [x] إضافة تأثيرات حركة وتأكيد مرئي عند تحديث الرصيد وإكمال المهام
- [x] إضافة مركز إشعارات داخل التطبيق لمهام جديدة ونجاح السحب
- [x] إضافة فلاتر متقدمة لحالة وطريقة ومبلغ وتاريخ عمليات السحب في لوحة المسؤول
- [x] إضافة اختبارات لتأثيرات التفاعل، الإشعارات، وفلاتر لوحة المسؤول
- [x] ربط حركة الرصيد بتغير balance الفعلي بعد إكمال المهمة والسحب
- [x] إنشاء إشعارات الخادم عند توفر مهام جديدة وعند نجاح مراجعة السحب أو دفعه
- [x] إضافة فلاتر تاريخ From/To إلى واجهة عمليات السحب
- [x] توسيع اختبارات الأحداث والإشعارات وفلاتر التاريخ
