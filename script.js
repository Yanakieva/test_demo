(function ($, window, expertm, kendo, utils, ui, undefined) {

    var NS = 'BankStatements';
    
    var
        ViewModel = kendo.ui.ExpertMViewModel,
        Window = kendo.ui.ExpertMWindow,
        DataModel = kendo.data.ExpertMDataModel,
        extend = $.extend, isArray = $.isArray, proxy = $.proxy, each = $.each, map = $.map,
        NomUser = kendo.ui.HRNomUser, NomUserDataSource = kendo.data.NomUserDataSource, DataSource = kendo.data.DataSource
    
    ;
    
    var EVENT_CRITICAL_ERROR = 'criticalError';
     
    var WaitingBulkInvoicePaymentModel = DataModel.extend({

        init: function (data) {
            var that = this;
             // If data.invoiceArray is not provided, default to an empty array
            data = data || {};
            data.invoiceArray = data.invoiceArray || [];


            DataModel.fn.init.call(that, data);

             // Ensure that invoiceArray is bound correctly and initialized
            that.invoiceArray = data.invoiceArray;
            // Events, triggered from buttons
            that._bindEvents();
        },
        _publicModel: function () { // public model definition (used from toJSON)
    
            return {
                id: null,
                contragent: { id: null, code: null },
                ska: { id: null, code: null },
                paymentSum: null,
                invoiceArray: [],
                total: 0
                
            };
        },
        _privateModel: function () { // private model definition (excluded from toJSON)
            return {
                fieldErrors: null,
                errors: [],
            };
        },

        // Function to get accounts
        _getAccounts: function() {
            return this._ajaxRequest('/bank-statements/waiting/get-ismpl', 'GET');
        },

        // Function to get contragents
        _getContragents: function() {
            return this._ajaxRequest('/bank-statements/waiting/get-contragents', 'GET');
        },

        // Generic AJAX request function
        _ajaxRequest: function(url, type) {
            var that = this,
                df = $.Deferred();

            $.ajax({
                url: url,
                type: type,
                dataType: 'json',
                success: function(resp) {
                    Array.isArray(resp) ? df.resolve(resp) : df.reject(resp);
                },
                error: function(xhr) {
                    var error = xhr.responseJSON && xhr.responseJSON.message ? xhr.responseJSON.message : 'Internal Server Error';
                    alert(error);
                    df.reject(xhr);
                }
            });

            return df.promise();
        },
        
        // Function to bind events
        _bindEvents: function() {
            var that = this;
            const events = [
                { selector: '#startProcedureButton', handler: () => that._startProcedure() },
                { selector: '#clearInvoiceNumbers', handler: that._clearInvoiceNumbers },
                { selector: '#distributeAscDate', handler: () => that._distributePayment('ascDate') },
                { selector: '#distributeDescDate', handler: () => that._distributePayment('descDate') },
                { selector: '#distributeEndline', handler: () => that._distributePayment('ascEndline') },
                { selector: '#distributeDescEndline', handler: () => that._distributePayment('descEndline') },
                { selector: '#clearInputValues', handler: that._clearInputValues }
            ];

            events.forEach(event => {
                $(document).off('click', event.selector); // Unbind existing events first
                //$(document).on('click', event.selector, event.handler.bind(that)); // Bind new events
             $(document).on('click', event.selector, event.handler); 
            });
        },

        _startProcedure: function() {
            var that = this;

            console.log("that inside _startProcedure:", that);
            if (!that.get('ska.id') || !that.get('contragent.id') ) {
                alert('Липсват данни за сметка или контрагент.');
                return;
            }

            var formData = {
                skaCode: that.get('ska.id'),
                kontrId: that.get('contragent.id')
            };

            $.ajax({
                url: '/bank-statements/waiting/get-invoice-balances',
                type: 'POST',
                contentType: 'application/json', 
                data: JSON.stringify(formData), 
                success: function(resp) {                    
                    that.set("invoiceArray", resp || [])
                    console.log("Updated invoiceArray:", that.get("invoiceArray"));
                    // Now initialize the grid with the updated data
                    that._initializeGrid(resp);
                },
                error: function(xhr, textStatus, errorThrown) {
                    console.error('Error fetching invoice balances:', errorThrown);
                    alert('Failed to start procedure. Please try again.');
                }
            });
        },

        _clearInputValues: function() {
            const grid = $("#gridContainer").data("kendoGrid");
            grid.dataSource.data().forEach(dataItem => {
                dataItem.set("userInput", '');
            });
    
            const isChecked = document.getElementById('clearInputValues').checked;
            $("#grid .row-checkbox").prop("checked", isChecked);
    
            grid.refresh();
            this.calculateTotal();
        },

        _distributePayment: function (sortDirection) {
            const grid = $("#gridContainer").data("kendoGrid");
            const dataItems = grid.dataSource.data();
        
            // Clear previous values
            dataItems.forEach(dataItem => {
                dataItem.set("userInput", '');
            });

            // Payment sum and invoice numbers input
            const paymentSum = parseFloat(document.getElementById('paymentSum').value) || 0;
            const invoiceNumbers = this._getInvoiceNumbers();

            let remainingPayment = paymentSum;

            // Sort based on provided direction
            this._sortDataItems(dataItems, sortDirection);

            // Distribute payment
            this._calculateDistributedPayment(dataItems, invoiceNumbers, remainingPayment);
            grid.refresh();
            this.calculateTotal();

        },

        // Get invoice numbers from input
        _getInvoiceNumbers: function() {
            const invoiceNumbersInput = document.getElementById('payedInvoces').value;
            return invoiceNumbersInput ? invoiceNumbersInput.split(/[,\s,:;/-]+/).map(num => num.trim()).filter(num => /^[0-9]+$/.test(num)) : [];
        },

        // Sort data items based on sort direction
        _sortDataItems: function(dataItems, sortDirection) {
            dataItems.sort((a, b) => {
                switch (sortDirection) {
                    case 'ascDate':
                        return a.invDate - b.invDate;
                    case 'descDate':
                        return b.invDate - a.invDate;
                    case 'ascEndline':
                        return a.paymentDate - b.paymentDate;
                    case 'descEndline':
                        return b.paymentDate - a.paymentDate;
                    default:
                        return 0;
                }
            });
        },

        // Calculate the distributed payment
        _calculateDistributedPayment: function(dataItems, invoiceNumbers, remainingPayment) {
            for (let i = 0; i < dataItems.length; i++) {
                const dataItem = dataItems[i];

                // Skip if not in invoice numbers
                if (invoiceNumbers.length > 0 && !invoiceNumbers.includes(dataItem.nfak)) {
                    continue;
                }

                const balanceValue = dataItem.balance;

                // Determine the amount to fill
                if (remainingPayment > 0 && balanceValue > 0) {
                    const amountToFill = Math.min(balanceValue, remainingPayment);
                    dataItem.set("userInput", amountToFill);
                    remainingPayment -= amountToFill;
                }

                if (remainingPayment <= 0) {
                    break;
                }
            }
        },


        // Initialize the grid with data
        _initializeGrid: function(data) {
            const that = this;
            const gridContainer = document.getElementById('gridContainer');
            gridContainer.innerHTML = '';

            const invoiceData = that.get("invoiceArray") || [];

            $(gridContainer).kendoGrid({
                dataSource: {
                    //data: data,
                    //data: this.dataModel.invoiceArray, // Bind grid data to the model's invoiceArray
                    data: invoiceData,
                    schema: {
                        model: {
                            fields: {
                                ska: { type: 'number', editable: false },
                                idan: { type: 'number', editable: false },
                                p1: { type: 'number', editable: false },
                                p2: { type: 'number', editable: false },
                                p3: { type: 'number', editable: false },
                                p4: { type: 'number', editable: false },
                                p5: { type: 'number', editable: false },
                                nfak: { type: 'string', editable: false },
                                kontrId: { type: 'number', editable: false },
                                invDate: { type: 'date', editable: false },
                                paymentDate: { type: 'date', editable: false },
                                kdss: { type: 'number', editable: false },
                                kks: { type: 'number', editable: false },
                                balance: { type: 'number', editable: false },
                                userInput: { type: 'number' }
                            }
                        }
                    },
                    pageSize: 10
                },
                sortable: true,
                pageable: true,
                editable: true,
                filterable: { mode: 'row' },
                columns: this._getGridColumns(),
                dataBound: function() {
                    const grid = this; // Here, 'this' refers to the Kendo Grid
                    const dataItems = grid.dataSource.view(); // Get the visible data items in the grid
                
                    dataItems.forEach(dataItem => {
                        that._updateToggleIcon(dataItem); // Call the update icon function for each data item
                    });
                }
            });

            // Call to set up grid events after grid initialization
            that._setupGridEvents(); 

            $("#gridContainer").show();
            that._bindEvents();
        },
        
        // Define grid columns
        _getGridColumns: function() {
            const that = this;
            return [
                {
                    title: "",
                    width: "50px",
                    template: function(dataItem) {
                        const iconClass = dataItem.userInput === dataItem.balance ? "fa-check-square" : "fa-square-o";
                        const color = dataItem.userInput ? "green" : "black";
                        return `<i class='fa ${iconClass} toggle-check' data-id='${dataItem.idan}' style='cursor: pointer; font-size: 17px; color: ${color};'></i>`;
                    },
                    attributes: { "class": "text-center" }
                },
                {
                    field: 'nfak',
                    title: 'Invoice Number',
                    editable: false,
                    filterable: {
                        cell: {
                            operator: "contains",
                            suggestionOperator: "contains"
                        }
                    }
                },
                {
                    field: 'invDate',
                    title: 'Invoice Date',
                    format: "{0:dd.MM.yyyy}",
                    editable: false,
                    filterable: {
                        cell: {
                            operator: "contains",
                            suggestionOperator: "contains"
                        }
                    }
                },
                {
                    field: 'balance',
                    title: 'Balance',
                    editable: false
                },
                {
                    field: 'userInput',
                    title: 'User Input',
                    editor: (container, options) => {
                        // Use arrow function to maintain the 'this' context
                        this.userInputEditor(container, options);
                    },
                    format: "{0:n2}",
                    width: '150px'
                }
            ];
        },

        _setupGridEvents: function() {
            const that = this;
            const grid = $("#gridContainer").data("kendoGrid");
            
            // Check if change event is being triggered
            grid.bind("change", function(e) {
                const dataItem = grid.dataItem(grid.select());
                console.log("Grid change event fired, dataItem:", dataItem); // Debugging log
                that._updateToggleIcon(dataItem);
            });
        
             // Add event listener for Enter key in input fields
            grid.tbody.on("keydown", "input", function(e) {
                if (e.key === "Enter") {
                    const $currentTd = $(this).closest('td');
                    const $currentRow = $(this).closest('tr');
                    const uid = $currentRow.data("uid"); // Get the UID of the row
                    const dataItem = grid.dataSource.getByUid(uid); // Get the corresponding data item
                    const field = grid.columns[$currentTd.index()].field; // Get the field associated with the cell

                    // Invoke the userInputEditor function, passing a mock container and options
                    const container = $currentTd; // Mock container for editor
                    const options = {
                        field: field,
                        model: dataItem
                    };
                    
                    // Call userInputEditor function
                    that.userInputEditor(container, options);
                }
            });

            // Add event listener for toggle-check click
            grid.tbody.on("click", ".toggle-check", function() {
                const icon = $(this);
                const idan = icon.data("id");
                const dataItem = grid.dataSource.data().find(item => item.idan === idan);
            
                if (!dataItem) {
                    console.error("DataItem not found for icon with data-id:", idan);
                    return;
                }
            
                // Toggle userInput based on the current icon state
                if (icon.hasClass("fa-square-o")) {
                    dataItem.set("userInput", dataItem.balance); // Set userInput to balance
                } else {
                    dataItem.set("userInput", null); // Clear userInput
                }
            
                // Call _updateToggleIcon to refresh the icon based on updated dataItem
                that._updateToggleIcon(dataItem);

                // Refresh the grid and update totals
                grid.refresh();
                that.calculateTotal(); // Assuming you have a function to calculate the total
            });
        },

        // Clear invoice numbers input
        _clearInvoiceNumbers: function() {
            $("#payedInvoces").val('');
        },

        userInputEditor: function(container, options) {
            var that = this; // 'that' should point to the correct context
            console.log("that inside userInputEditor:", that);
        
            $('<input>')
                .attr('name', options.field)
                .appendTo(container)
                .kendoNumericTextBox({
                    format: 'n2',
                    decimals: 2,
                    step: 0.01,
                    spinners: false
                })
                .on('blur', function () {
                    let inputElement = this; // Preserve 'this' which refers to the input field
                    setTimeout(() => { // Use arrow function to preserve context inside setTimeout
                        console.log("Here1"); // This should log now
                        
                        let $currentTd = $(inputElement).closest('td'); // Use 'inputElement' instead of 'this'
                        if ($currentTd.length) {
                            let $currentRow = $currentTd.closest('tr');
                            let idan = $currentRow.data("uid");
                            let grid = $("#gridContainer").data("kendoGrid");
                            let dataItem = grid.dataSource.getByUid(idan);
        
                            // Check if _updateToggleIcon is a function
                            if (typeof that._updateToggleIcon === 'function') {
                                console.log("Here");
                                console.log ("dataItem", dataItem);
                                that._updateToggleIcon(dataItem);
                            } else {
                                console.error("_updateToggleIcon is not a function", that);
                            }
        
                            // Calculate the total based on user input
                            let dataItems = grid.dataSource.data();
                            let total = 0;
        
                            dataItems.forEach(item => {
                                total += parseFloat(item.userInput) || 0; 
                            });
        
                            that.set('total', total);
                            that._editNextCell($currentRow, $currentTd);
                        }
                    }, 0);
                });
        },
        
        
        // Calculate the total
        calculateTotal: function() {
            const grid = $("#gridContainer").data("kendoGrid");
            const dataItems = grid.dataSource.data();
            const total = dataItems.reduce((sum, item) => sum + (parseFloat(item.userInput) || 0), 0);
            this.set('total', total); // Use the computed total here
        },
       
        _updateToggleIcon: function(dataItem) {
            console.log("Updating toggle icon for dataItem:", dataItem); // Debugging log
        
            let iconSelector = `i[data-id='${dataItem.idan}']`;
            let icon = $(iconSelector);
        
            if (icon.length === 0) {
                console.error(`Icon not found for data-id: ${dataItem.idan}`); // Debugging log
                return; // Exit if the icon is not found
            }
        
            // Check user input against balance
            if (dataItem.userInput === dataItem.balance) {
                console.log("Setting icon to check-square"); // Debugging log
                icon.removeClass("fa-square-o").addClass("fa-check-square").css('color', 'green');
            } else {
                if (!dataItem.userInput) {
                    console.log("Setting icon to square-o (no user input)"); // Debugging log
                    icon.removeClass("fa-check-square").addClass("fa-square-o").css('color', 'black');
                } else {
                    console.log("Setting icon to check-square (user input exists)"); // Debugging log
                    icon.removeClass("fa-square-o").addClass("fa-check-square").css('color', '#f0ad4e');
                }
            }
        },

        // Edit the next cell in the grid after pressing Enter
        _editNextCell: function($currentRow, $currentTd) {
            let $nextRow = $currentRow.next('tr');
            if ($nextRow.length) {
                let tdIndex = $currentTd.index();
                let grid = $("#gridContainer").data("kendoGrid");
                let nextCell = $nextRow.children().eq(tdIndex);
                grid.editCell(nextCell);
                let $nextInput = nextCell.find('input');
                if ($nextInput.length) {
                    $nextInput.focus();
                }
            }
        },

        // Initialize the model
        _initModel: function(model) {
            var that = this;
            model.type = 1; // Fixed values cannot be overridden
        },

        // Fill the model with data
        _fillModel: function(data) {
            var that = this;
            if (!data.length) {
                return;
            }
            var data = data[0];
            that.set('id', data.id);
            that.set('paymentSum', data.paymentSum);

            if (data.skaCode) {
                that.set('ska.id', data.skaCode);
            }
            if (data.contragentCode) {
                that.set('contragent.id', data.kontrId);
            }
        }
    });

    
    var WaitingBulkInvoicePaymentWidget = ViewModel.extend({
        createDataModel: function (params) {
            return new WaitingBulkInvoicePaymentModel(params);
        },
    
        bindDataModel: function () {
            var that = this;
            var params = that.options.params;
        
            // Initialize the ComboBoxes
            that._initAccountComboBox(params.skaCode); 
            that._initContragentComboBox(params.kontrId); 
        
            console.log('Params for BulkInvoicePaymentWidget', params);
        },

        _initAccountComboBox: function(skaCode) {
            var that = this;
        
            // Fetch accounts from the server and initialize the ComboBox
            that.dataModel._getAccounts().done(function(data) {
                var comboBox = $("#skaComboBox").kendoComboBox({
                    dataTextField: "name",
                    dataValueField: "id",
                    dataSource: data,
                    placeholder: "Търсете сметка...",
                    change: function(e) {
                        var value = this.value();
                        that.dataModel.set('ska.id', value); // Bind selected account ID to the model
                    }
                }).data("kendoComboBox");
        
                // Pre-select the account based on skaCode
                if (skaCode) {
                    comboBox.value(skaCode); // Preselect the value using skaCode
                    that.dataModel.set('ska.id', skaCode); // Update the model with skaCode
                }
        
            }).fail(function() {
                console.error('Failed to fetch account data');
            });
        },
        
        _initContragentComboBox: function(kontrId) {
            var that = this;
        
            // Fetch contragents and initialize the ComboBox
            that.dataModel._getContragents().done(function(data) {
                var comboBox = $("#contragentComboBox").kendoComboBox({
                    dataTextField: "name",
                    dataValueField: "id",
                    dataSource: data,
                    placeholder: "Търсете контрагент...",
                    change: function(e) {
                        var value = this.value();
                        that.dataModel.set('contragent.id', value); // Bind selected contragent ID to the model
                    }
                }).data("kendoComboBox");
        
                // Pre-select the contragent based on kontrId
                if (kontrId) {
                    comboBox.value(kontrId); // Preselect the value using kontrId
                    that.dataModel.set('contragent.id', kontrId); // Update the model with kontrId
                }
        
            }).fail(function() {
                console.error('Failed to fetch contragent data');
            });
        },

        unbindDataModel: function () {
            var that = this;
/*             that.dataModel.unbind(EVENT_SAVE, proxy(that._onSave, that)); */
        },
        toJSON: function () {
            return this.dataModel ? this.dataModel.toJSON() : null;
        },
       
                
        /* isValid: function () { //You can skip this method if you need only the validator rules
            var that = this, df = $.Deferred(), valid = false;
            //return ;
            that.validator.hideMessages();
            that.dataModel.set('fieldErrors', null); //Clear field's remote validation errors
            df.fail(function () {
                //when the validation fails, focus the first invalid input
                utils.focusFirstInput(that.element, true, '.k-invalid');
            });
            valid = ViewModel.fn.isValid.call(this);
            if (!valid) {
                df.reject();
                return df.promise();
            }
            that.dataModel.set('errors', []);
            var data = that.dataModel.toJSON();
            return df.promise();
        }, */

        isValid: function () {
            var that = this,
                df = $.Deferred(),
                valid = false;
        
            console.log("isValid method called. Validating form data...");
        
            // Hide messages initially
            that.validator.hideMessages();
            that.dataModel.set('fieldErrors', null); // Clear field's remote validation errors
        
            df.fail(function () {
                // Log when validation fails and focus on the first invalid input
                console.log("Validation failed. Focusing on first invalid input.");
                utils.focusFirstInput(that.element, true, '.k-invalid');
            });
        
            // Call the base isValid method and log result
            valid = ViewModel.fn.isValid.call(this);
            console.log("isValid result from ViewModel:", valid);
        
            if (!valid) {
                console.log("Validation failed. Errors:", that.dataModel.errors);
                df.reject();
                return df.promise();
            }
        
            // Log that validation passed
            console.log("Validation passed. Form data:", that.dataModel.toJSON());
            that.dataModel.set('errors', []);
        
            return df.promise();
        },
       
        options: {
            waitAjaxRequests: true,
            name: NS+'WaitingBulkInvoicePayment',
            //debug: false, //Set this to false if you dont want debug view messages in console, the default value is 'auto': true in deveelopment and false in production environment
            htmlTemplateId: NS+'WaitingBulkInvoicePaymentWidgetTemplate', //The html template id to be used for this widget
            //templateId: NS+'MyKendoWidgetTemplate', //The kendo template id to be used for this widget (if your template is pure html only then use htmlTemplateId)
            }
    });
    WaitingBulkInvoicePaymentWidget.DataModelClass = WaitingBulkInvoicePaymentModel;
    kendo.ui.plugin(WaitingBulkInvoicePaymentWidget);
    
    var WaitingBulkInvoicePaymentWindow = Window.extend({
        init: function (element, options) {
            this.options.onCloseQuery = proxy(this._onCloseQuery, this);
            $(element).addClass('waiting-bulk-invoice-payment-window');
            Window.fn.init.call(this, element, options);
            options = this.options;
    
            this.frame = new WaitingBulkInvoicePaymentWidget($('.modal-body', this.element), options.frame);
            var that = this;
            this.frame.bind(EVENT_CRITICAL_ERROR, function () {
                that.close();
            });

             // Initialize the data model here
            this.dataModel = new WaitingBulkInvoicePaymentModel(options.params);
            var windowElement = $(that.element).closest('.k-window');
            var footer = windowElement.find('.modal-footer');
            that.appendTotalToFooter(footer);

             // Change the submit button behavior
            this._overrideSubmitButton();

        },
    
        _overrideSubmitButton: function () {
            var that = this;
    
            // Select the submit button using its classes
            var submitButton = $(this.element).find('.btn.btn-primary.btn-01');
    
            if (submitButton.length) {
                submitButton.on('click', function (e) {
                    e.preventDefault(); // Prevent the default form submission
                    console.log("submit"); // Log a message to the console
    
                    // Call the saveInvoices function
                    that.saveInvoices(); // Call the saveInvoices method
                });
            }
        },
    
        saveInvoices: function () {

            console.log("total ot modela",  this.dataModel.total);
            let total = this.dataModel.total || 0;
            let paymentSum = parseFloat(document.getElementById('paymentSum').value.replace(',', '.')) || 0;

            console.log("Total Value:", total);
            console.log("Payment Sum:", paymentSum);

            let grid = $("#gridContainer").data("kendoGrid");
    
            // Validation
            if (!grid) {
                return this.showAlert('Въведете данни за сметка и контрагент, за да изтеглите данни по фактури.');
            }
            if (total !== paymentSum) {
                return this.showAlert('Сумата на плащането се различава от сумата по разпреление.');
            }
            let selectedInvoices = this.collectSelectedInvoices(grid);
            if (selectedInvoices.length === 0) {
                return this.showAlert('Въведете данни за плащане поне по една фактура.');
            }
    
            let rowId = this.rowId; // Assuming rowId is defined in the context
            let kontrId = this.kontrId; // Assuming kontrId is defined in the context
    
            console.log("rowId", rowId);
            console.log("kontrId", kontrId);
    
            let dataToSend = {
                rowId: rowId,
                kontrId: kontrId,
                invoices: selectedInvoices
            };
    
            fetchUtility.post(
                '/bank-statements/waiting/add-list-invoices', dataToSend,
                this.handleSaveSuccess,
                this.handleSaveError
            );
        },
    
        collectSelectedInvoices: function (grid) {
            let gridData = grid.dataSource.data();
            return gridData.filter(item => item.userInput != null && item.userInput !== '')
                .map(item => ({
                    ska: item.ska,
                    nfak: item.nfak,
                    kontr: item.kontrId,
                    idan: item.idan,
                    balance: item.balance,
                    p1: item.p1,
                    p2: item.p2,
                    p3: item.p3,
                    p4: item.p4,
                    p5: item.p5,
                    sum: item.userInput
                }));
        },
    
        showAlert: function (message) {
            alert(message);
        },
    
        handleSaveSuccess: function (data) {
            if (data.success) {
                $('#invoiceListModal').modal('hide');
                expertm.app.ui.growl.success(__(data.message));
            } else {
                this.showAlert('Failed to save invoices. Reason: ' + (data.message || 'Unknown error.'));
            }
        },
    
        handleSaveError: function (error) {
            console.error('Network error:', error);
            this.showAlert('Network error occurred. Please try again.');
        },
       
        appendTotalToFooter: function(footer) {
            // Add the total amount display as a div to the footer
            footer.css({
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            });
        
            // Prepend the total display HTML
                footer.prepend(`
                <div style="flex-grow: 1; text-align: left; margin-right: 10px;">
                    Разпределена сума по фактури: <span id="totalValue" data-bind="text: total"></span> лв.
                </div>
            `);

            // Bind the new element to the data model
             kendo.bind(footer, this.dataModel);
             console.log("this.dataModel: ", this.dataModel);
        },

        _onCloseQuery: function (modalResult) {
            if (modalResult <= 0) {
                return true;
            }
            return this.frame.isValid();
        },
        _onSaveSuccess: function () {
          this.close();
        },
        execute: function (params) {
            var that = this, df = $.Deferred();
            that.frame.setParams(params);
            console.log('setParams', params);
    
            Window.fn.execute.call(that).then(function () {
                df.resolve(that.frame.toJSON());
            }, df.reject);
    
            return df.promise();
        },
        destroy: function () {
            var that = this;
            if (that.frame) {
                that.frame.destroy();
            }
            Window.fn.destroy.call(that);
        },
        
        options: {
            name: NS+'WaitingBulkInvoicePaymentWindow',
            title: __('Bulk Invoice Payment'),
            icon: 'fa fa-pencil',
            buttons: ['cancel', 'submit'],
            width: 900,
            frame: {
                autoBindParams: false, //Do not bind the frame params automatically
                params: {
                  
                }
            }
        }
    });
    kendo.ui.plugin(WaitingBulkInvoicePaymentWindow);
    
    
    })(jQuery, window, window.expertm, window.kendo, window.expertm.app.utils, window.expertm.app.ui);
    
