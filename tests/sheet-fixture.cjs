function sheet(rows,onRead=()=>{}){
  return {
    getLastRow:()=>rows.length,getMaxRows:()=>rows.length,getLastColumn:()=>Math.max(0,...rows.map(r=>r.length)),
    appendRow(values){rows.push(Array.from(values))},
    insertRowsAfter(row,count){rows.splice(row,0,...Array.from({length:count},()=>[]))},
    getRange(row,col,height=1,width=1){
      if(row==='A:A'||row==='C:C')return {createTextFinder(pattern){
        const column=row==='A:A'?0:2;
        let caseSensitive=false;
        return {
          useRegularExpression(){return this},
          matchCase(value){caseSensitive=value;return this},
          findAll(){
            const regex=new RegExp(pattern,caseSensitive?'':'i');
            return rows.flatMap((cells,i)=>regex.test(String(cells[column]??''))?[{getRow:()=>i+1}]:[]);
          }
        };
      }};
      const values=()=>{onRead(row,height);return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>rows[row-1+i]?.[col-1+j]??''))};
      return {
        getValues:values,getDisplayValues:()=>values().map(r=>r.map(String)),
        setValue(value){this.setValues([[value]]);return this},setNumberFormat(){return this},
        setValues(data){data.forEach((r,i)=>r.forEach((x,j)=>{(rows[row+i-1]??=[])[col+j-1]=x}));return this}
      };
    }
  };
}

module.exports = {sheet};
