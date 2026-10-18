module.exports = {
  ...require('./employee-accounts'),
  ...require('./legacy-account-merge'),
  addUser: require('./add-user'),
  updateUser: require('./update-user')
}
