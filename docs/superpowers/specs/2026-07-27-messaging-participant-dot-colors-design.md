# Messaging Participant Dot Colors

## Goal

Make the participant dots in the managed-conversation header identify each participant's role without changing any other messaging behavior or styling.

## Approved visual mapping

- Relationship manager: muted brown `#8B5E3C`
- Investor: muted green `#2E8B57`
- Business owner: clear blue `#3B82F6`
- Any unknown or future role: retain the existing primary-color fallback

Only the six-pixel dot beside each participant name changes. The participant chip, name, role label, message bubbles, alignment, and conversation logic remain unchanged.

## Implementation design

The participant renderer will map the three supported messaging roles to fixed, safe CSS modifier classes on `.participant-dot`. It will not place raw database role values into a class or inline style.

`messages.html` will define one color rule for each modifier class while keeping the existing `.participant-dot` primary color as the fallback. `js/messages.js` will apply the modifier returned by the role mapper when it renders active participant chips.

## Safety and accessibility

The colors are a secondary visual cue. Every chip will continue to show the participant's written role, so meaning does not depend on color alone. The selected shades remain distinct against the current pale chip background, and the change introduces no animation or interaction.

## Verification

Test-first coverage will verify:

1. The participant renderer assigns the correct safe modifier to relationship managers, investors, and business owners.
2. Unknown roles receive no role-specific modifier and keep the default dot color.
3. The messaging stylesheet defines the three approved colors.
4. Existing active-member filtering and identity escaping still pass.
5. The full backend test suite remains green.
6. The live desktop and 390-pixel messaging views retain their existing layout and show the three role colors.

## Scope

This change is limited to the messaging participant-dot presentation and its focused tests. It does not alter the database, API, permissions, conversations, messages, notifications, or any non-messaging page.
