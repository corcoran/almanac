# push-tag — fish wrapper for scripts/push-tag.sh, guarded to the repo dir.
#
# Install on a machine by symlinking (or copying) into the fish autoload dir:
#   ln -s ~/Work/almanac/scripts/fish/push-tag.fish \
#         ~/.config/fish/functions/push-tag.fish
#
# Adjust `repo` below if you check the repo out somewhere other than
# ~/Work/almanac on that machine.
function push-tag --description 'Bump+push a semver tag in the almanac repo'
    set -l repo ~/Work/almanac
    # Only run from inside the almanac working tree.
    if not string match -q "$repo*" -- (pwd -P)
        echo "push-tag: only available inside $repo" >&2
        return 1
    end
    $repo/scripts/push-tag.sh $argv
end
