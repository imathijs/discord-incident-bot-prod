class Vote {
  constructor(props) {
    this.userId = props?.userId || null;
    this.category = props?.category || null;
    this.plus = Boolean(props?.plus);
    this.minus = Boolean(props?.minus);
    this.reporterCategory = props?.reporterCategory || null;
    this.reporterPlus = Boolean(props?.reporterPlus);
    this.reporterMinus = Boolean(props?.reporterMinus);
  }
}

module.exports = { Vote };
