git reset HEAD~1
rm ./backport.sh
git cherry-pick 78010088765645eeb52dcc7d67aa4ea4105d6f8f
echo 'Resolve conflicts and force push this branch.\n\nTo backport translations run: bin/i18n/merge-translations <release-branch>'
