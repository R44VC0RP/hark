import { backOr } from "../src/lib/navigation";
import { EmptyState } from "../src/ui/empty-state";
import { List } from "../src/ui/list";

/**
 * A link Hark has no screen for (an old or mistyped hark:// link). Expo
 * Router's own fallback is a dark developer page with a sitemap; this one
 * says what happened and goes back to where the person was (or into the
 * app when there is nothing to go back to).
 */
export default function NotFound() {
  return (
    <List alwaysBounceVertical={false}>
      <EmptyState
        actionTitle="Go Back"
        message="Hark doesn’t have a page for this link."
        onAction={() => backOr("/")}
        symbol="link"
        title="Link Not Found"
      />
    </List>
  );
}
