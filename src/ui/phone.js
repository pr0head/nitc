// Phone layouts. The CSS uses the same breakpoints.
//   phone  — a phone either way up (@media (max-width: 560px), (max-height: 500px)):
//            COMM opens full screen from the menu, no zoom buttons, the map
//            status shows only when something is wrong
//   narrow — a phone upright (@media (max-width: 560px)): the portal card is a
//            bottom sheet; on its side the card stays a panel on the right
export const phone = matchMedia('(max-width: 560px), (max-height: 500px)');
export const narrow = matchMedia('(max-width: 560px)');
